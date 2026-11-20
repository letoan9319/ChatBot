import json
import os
import sys
from pathlib import Path

import pymupdf
import torch
from PIL import Image
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration
from mineru_vl_utils import MinerUClient
from mineru_vl_utils.post_process import json2md

pdf_path, output_path, model_path = sys.argv[1:]
model = Qwen2VLForConditionalGeneration.from_pretrained(
    model_path, dtype=torch.float16, device_map={"": 0}, local_files_only=True
)
processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)

batch_size = min(2, max(1, int(os.getenv("MINERU_BATCH_SIZE", "2"))))
client = MinerUClient(
    backend="transformers", model=model, processor=processor,
    image_analysis=False, batch_size=batch_size,
)
pages = []
total = 0
with pymupdf.open(pdf_path) as pdf:
    index = 0
    while index < len(pdf):
        count = min(batch_size, len(pdf) - index)
        images = []
        for page_index in range(index, index + count):
            page = pdf[page_index]
            scale = min(2.0, 4096 / max(page.rect.width, page.rect.height, 1))
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
        try:
            results = client.batch_two_step_extract(images)
        except torch.cuda.OutOfMemoryError:
            if batch_size == 1:
                raise
            batch_size = max(1, batch_size // 2)
            torch.cuda.empty_cache()
            client = MinerUClient(
                backend="transformers", model=model, processor=processor,
                image_analysis=False, batch_size=batch_size,
            )
            print(f"Reducing MinerU batch size to {batch_size}", flush=True)
            continue
        if len(results) != count:
            raise RuntimeError("MinerU returned an unexpected page count")
        for offset, result in enumerate(results):
            text = json2md(result).strip()
            total += len(text)
            if total > 1_000_000:
                raise ValueError("Document exceeds text limit")
            pages.append({"page": index + offset + 1, "text": text})
        index += count
        print(f"MinerU pages {index}/{len(pdf)}", flush=True)
Path(output_path).write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
