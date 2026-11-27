"""Convert fused Qwen 3.5 llama.cpp GGUF tensors to Ollama-compatible layout.

Splits row-wise quantized tensors without dequantization:
  - blk.<L>.attn_qkv_gate.weight (2560, 12288)
      -> blk.<L>.attn_qkv.weight  (2560, 8192)
      -> blk.<L>.attn_gate.weight (2560, 4096)
  - blk.<L>.ssm_beta_alpha.weight (2560, 64)
      -> blk.<L>.ssm_beta.weight  (2560, 32)
      -> blk.<L>.ssm_alpha.weight (2560, 32)
Drops MTP nextn layer blk.32.* tensors not present in Ollama's 426-tensor layout.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import struct

# GGML type -> (block_elements, block_bytes)
GGML_TYPES: dict[int, tuple[int, int]] = {
    0: (1, 4),      # F32
    1: (1, 2),      # F16
    2: (32, 18),    # Q4_0
    3: (32, 20),    # Q4_1
    6: (32, 22),    # Q5_0
    7: (32, 24),    # Q5_1
    8: (32, 34),    # Q8_0
    9: (32, 36),    # Q8_1
    10: (256, 84),  # Q2_K
    11: (256, 110), # Q3_K
    12: (256, 144), # Q4_K
    13: (256, 176), # Q5_K
    14: (256, 210), # Q6_K
    15: (256, 292), # Q8_K
    30: (1, 2),     # BF16
}

ATTN_FUSED_RE = re.compile(r"^(blk\.\d+)\.attn_qkv_gate\.weight$")
SSM_FUSED_RE = re.compile(r"^(blk\.\d+)\.ssm_beta_alpha\.weight$")
MTP_DROP_RE = re.compile(r"^blk\.32\.")


def _read_str(f) -> str:
    n = struct.unpack("<Q", f.read(8))[0]
    return f.read(n).decode("utf-8", errors="strict")


def _pack_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<Q", len(b)) + b


def _skip_val(f, vtype: int):
    sizes = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}
    fmt = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}
    if vtype in sizes:
        return struct.unpack(fmt[vtype], f.read(sizes[vtype]))[0]
    if vtype == 8:
        return _read_str(f)
    if vtype == 9:
        et, cnt = struct.unpack("<IQ", f.read(12))
        return [_skip_val(f, et) for _ in range(cnt)]
    raise ValueError(f"Unsupported GGUF metadata type: {vtype}")


def _tensor_bytes(dims: tuple[int, ...], ttype: int) -> int:
    if ttype not in GGML_TYPES:
        raise ValueError(f"Unsupported GGML tensor type id: {ttype}")
    be, bb = GGML_TYPES[ttype]
    ne0 = dims[0]
    if ne0 % be != 0:
        raise ValueError(f"Leading dimension {ne0} not divisible by block size {be} for ttype={ttype}")
    other = 1
    for d in dims[1:]:
        other *= d
    return (ne0 // be) * bb * other


def _rewrite_kv_bytes(f, n_kv: int) -> tuple[bytes, int, int]:
    """Read KV entries, fix dropped-MTP metadata, and return (kv_bytes, out_n_kv, align)."""
    out_chunks: list[bytes] = []
    out_n_kv = 0
    align = 32

    for _ in range(n_kv):
        entry_start = f.tell()
        k = _read_str(f)
        vt = struct.unpack("<I", f.read(4))[0]
        v = _skip_val(f, vt)
        entry_end = f.tell()

        if k == "general.alignment":
            align = int(v)

        if k == "qwen35.nextn_predict_layers":
            continue

        if k == "qwen35.block_count" and int(v) > 32:
            out_chunks.append(_pack_str(k) + struct.pack("<II", 4, 32))
            out_n_kv += 1
            continue

        if k == "qwen35.attention.recurrent_layers" and isinstance(v, list) and len(v) > 32:
            trimmed = [bool(x) for x in v[:32]]
            payload = struct.pack("<IIQ", 9, 7, len(trimmed)) + b"".join(
                struct.pack("<?", item) for item in trimmed
            )
            out_chunks.append(_pack_str(k) + payload)
            out_n_kv += 1
            continue

        f.seek(entry_start)
        out_chunks.append(f.read(entry_end - entry_start))
        f.seek(entry_end)
        out_n_kv += 1

    return b"".join(out_chunks), out_n_kv, align


def convert_gguf(src: Path, dst: Path) -> dict:
    with src.open("rb") as f:
        magic = f.read(4)
        if magic != b"GGUF":
            raise ValueError(f"{src} is not a GGUF file")
        version, n_tensors, n_kv = struct.unpack("<IQQ", f.read(20))
        if version < 2:
            raise ValueError(f"Expected GGUF v2/v3, got v{version}")

        raw_kv_bytes, out_n_kv, align = _rewrite_kv_bytes(f, n_kv)

        src_tensors = []
        for _ in range(n_tensors):
            name = _read_str(f)
            nd = struct.unpack("<I", f.read(4))[0]
            dims = struct.unpack(f"<{nd}Q", f.read(8 * nd))
            ttype, offset = struct.unpack("<IQ", f.read(12))
            nbytes = _tensor_bytes(dims, ttype)
            src_tensors.append((name, dims, ttype, offset, nbytes))

        info_end = f.tell()
        src_data_start = ((info_end + align - 1) // align) * align

        # Build output tensor plan: list of (out_name, dims, ttype, src_offset_rel, nbytes)
        out_specs = []
        split_attn = 0
        split_ssm = 0
        dropped_mtp = 0

        for name, dims, ttype, offset, nbytes in src_tensors:
            if MTP_DROP_RE.match(name):
                dropped_mtp += 1
                continue

            m_attn = ATTN_FUSED_RE.match(name)
            if m_attn:
                if len(dims) != 2 or dims[1] != 12288:
                    raise ValueError(f"Unexpected dims for {name}: {dims}")
                be, bb = GGML_TYPES[ttype]
                row_bytes = (dims[0] // be) * bb
                qkv_bytes = row_bytes * 8192
                gate_bytes = row_bytes * 4096
                assert qkv_bytes + gate_bytes == nbytes
                prefix = m_attn.group(1)
                out_specs.append((f"{prefix}.attn_qkv.weight", (dims[0], 8192), ttype, offset, qkv_bytes))
                out_specs.append((f"{prefix}.attn_gate.weight", (dims[0], 4096), ttype, offset + qkv_bytes, gate_bytes))
                split_attn += 1
                continue

            m_ssm = SSM_FUSED_RE.match(name)
            if m_ssm:
                if len(dims) != 2 or dims[1] != 64:
                    raise ValueError(f"Unexpected dims for {name}: {dims}")
                be, bb = GGML_TYPES[ttype]
                row_bytes = (dims[0] // be) * bb
                beta_bytes = row_bytes * 32
                alpha_bytes = row_bytes * 32
                assert beta_bytes + alpha_bytes == nbytes
                prefix = m_ssm.group(1)
                out_specs.append((f"{prefix}.ssm_beta.weight", (dims[0], 32), ttype, offset, beta_bytes))
                out_specs.append((f"{prefix}.ssm_alpha.weight", (dims[0], 32), ttype, offset + beta_bytes, alpha_bytes))
                split_ssm += 1
                continue

            out_specs.append((name, dims, ttype, offset, nbytes))

        # Assign aligned offsets in output data section
        out_records = []
        cur_off = 0
        for name, dims, ttype, src_off, nbytes in out_specs:
            cur_off = ((cur_off + align - 1) // align) * align
            out_records.append((name, dims, ttype, cur_off, src_off, nbytes))
            cur_off += nbytes

        tmp_dst = dst.with_suffix(".gguf.tmp")
        with tmp_dst.open("wb") as out:
            out.write(b"GGUF")
            out.write(struct.pack("<IQQ", version, len(out_records), out_n_kv))
            out.write(raw_kv_bytes)
            for name, dims, ttype, out_off, _, _ in out_records:
                out.write(_pack_str(name))
                out.write(struct.pack("<I", len(dims)))
                out.write(struct.pack(f"<{len(dims)}Q", *dims))
                out.write(struct.pack("<IQ", ttype, out_off))

            header_end = out.tell()
            dst_data_start = ((header_end + align - 1) // align) * align
            if dst_data_start > header_end:
                out.write(b"\x00" * (dst_data_start - header_end))

            written_rel = 0
            for name, dims, ttype, out_off, src_off, nbytes in out_records:
                if out_off > written_rel:
                    out.write(b"\x00" * (out_off - written_rel))
                    written_rel = out_off
                f.seek(src_data_start + src_off)
                remaining = nbytes
                while remaining > 0:
                    chunk = f.read(min(remaining, 8 * 1024 * 1024))
                    if not chunk:
                        raise EOFError(f"Unexpected EOF reading tensor {name}")
                    out.write(chunk)
                    remaining -= len(chunk)
                written_rel += nbytes

    tmp_dst.replace(dst)
    return {
        "source_tensors": n_tensors,
        "output_tensors": len(out_records),
        "split_attn_qkv_gate": split_attn,
        "split_ssm_beta_alpha": split_ssm,
        "dropped_mtp_blk32": dropped_mtp,
        "output_path": str(dst),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--src",
        type=Path,
        default=Path("models/finetuned/Qwen3.5-4B.Q4_K_M.gguf"),
    )
    parser.add_argument(
        "--dst",
        type=Path,
        default=Path("models/finetuned/Qwen3.5-4B.Q4_K_M.ollama.gguf"),
    )
    args = parser.parse_args()
    stats = convert_gguf(args.src.resolve(), args.dst.resolve())
    print(stats)


if __name__ == "__main__":
    main()
