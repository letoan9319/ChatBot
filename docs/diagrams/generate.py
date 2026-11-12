"""Build ERDs from repository migrations and render PlantUML locally."""
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def schema():
    tables = {}
    for migration in sorted((REPO / 'supabase/migrations').glob('*.sql')):
        sql = re.sub(r'--[^\n]*', '', migration.read_text(encoding='utf-8'))
        for name, body in re.findall(r'create table public\.(\w+)\s*\((.*?)\n\);', sql, re.S):
            columns = []
            composite = re.search(r'primary key\s*\(([^)]+)\)', body)
            keys = set(composite[1].replace(' ', '').split(',')) if composite else set()
            for line in body.splitlines():
                match = re.match(r'\s*(\w+)\s+(uuid|text|bigint|integer|boolean|timestamptz|date|jsonb)\b(.*)', line)
                if not match:
                    continue
                field, kind, suffix = match.groups()
                pk = field in keys or 'primary key' in suffix
                ref = re.search(r'references (\w+)\.(\w+)(?:\((\w+)\))?', suffix)
                columns.append(dict(name=field, type=kind, pk=pk, required=pk or 'not null' in suffix,
                                    unique='unique' in suffix, ref=tuple(ref.groups()) if ref else None))
            tables[name] = columns
        for name, body in re.findall(r'alter table public\.(\w+)\s+(.*?);', sql, re.S):
            for field, kind, suffix in re.findall(r'add column (\w+)\s+(\w+)(.*?)(?=,\s*add column|$)', body, re.S):
                tables[name].append(dict(name=field, type=kind, pk=False,
                                         required='not null' in suffix, unique=False, ref=None))
    return tables


def build_erds():
    tables = schema()
    groups = {
        '04-erd': ['documents', 'document_chunks', 'knowledge_documents'],
        '04a-conversation-erd': ['conversations', 'messages', 'message_sources'],
        '04b-community-erd': ['study_groups', 'study_group_members', 'study_group_messages', 'notifications'],
        '04c-operations-erd': ['profiles', 'user_roles', 'learning_plans', 'study_activity_days', 'jobs', 'worker_heartbeats'],
    }
    assert set(tables) == {table for group in groups.values() for table in group}, 'ERD table coverage changed'
    refs = 0
    for filename, owned in groups.items():
        parents = {column['ref'][1] for table in owned for column in tables[table] if column['ref']}
        selected = sorted(set(owned) | parents)
        lines = ['@startuml', '!include style.iuml', 'hide circle', 'skinparam linetype ortho']
        for table in selected:
            label = 'auth.users' if table == 'users' else f'public.{table}'
            fields = tables[table] if table in owned else [dict(name='id', type='uuid', pk=True, required=True, unique=False, ref=None)]
            lines.append(f'entity "{label}" as {table} {{')
            for col in fields:
                marks = [mark for mark, present in [('PK', col['pk']), ('FK', col['ref']), ('UK', col['unique'])] if present]
                tags = ' '.join(f'<<{mark}>>' for mark in marks)
                lines.append(f"  {'* ' if col['required'] else ''}{col['name']} : {col['type']} {tags}".rstrip())
            lines.append('}')
        for table in owned:
            pk = {c['name'] for c in tables[table] if c['pk']}
            for col in tables[table]:
                if not col['ref']:
                    continue
                parent = col['ref'][1]
                left = '||' if col['required'] else '|o'
                right = 'o|' if col['unique'] or pk == {col['name']} else 'o{'
                connector = '--' if col['pk'] else '..'
                lines.append(f"{parent} {left}{connector}{right} {table} : {col['name']}")
                refs += 1
        lines.append('@enduml')
        (ROOT / f'{filename}.puml').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'ERD coverage: {len(tables)} public tables, {refs} foreign keys', flush=True)


def main():
    runpy.run_path(str(ROOT / 'functional-decomposition.py'), run_name='__main__')
    build_erds()
    java = os.environ.get('JAVA_BIN') or shutil.which('java')
    if not java:
        java = next((str(p) for p in (REPO / '.cache/plantuml').glob('*/bin/java.exe')), None)
    jar = Path(os.environ.get('PLANTUML_JAR', str(REPO / '.cache/plantuml/plantuml.jar')))
    if not java or not jar.is_file():
        raise SystemExit('Set JAVA_BIN and PLANTUML_JAR. See docs/diagrams/README.md.')
    sources = sorted(ROOT.glob('*.puml'))
    subprocess.run([java, '-Djava.awt.headless=true', '-jar', str(jar), '-charset', 'UTF-8',
                    '-failfast2', '-tsvg', *map(str, sources)], cwd=ROOT, check=True)
    for source in sources:
        svg = source.with_suffix('.svg')
        content = svg.read_text(encoding='utf-8')
        if 'Syntax Error' in content or 'An error has occurred' in content:
            raise SystemExit(f'PlantUML error in {source.name}')
        start = content.index('>', content.index('<svg')) + 1
        content = content[:start] + '<rect width="100%" height="100%" fill="#ffffff"/>' + content[start:]
        svg.write_text(content, encoding='utf-8')
    print(f'Rendered {len(sources)} SVG diagrams', flush=True)


if __name__ == '__main__':
    main()
