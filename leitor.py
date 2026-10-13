import os
import sys
from datetime import datetime
import subprocess

# --- CONFIGURAÇÕES ---

METADATA_TAG = ""
DIRETORIO_ALVO = '.'

# Mapeamento de extensões
EXTENSION_TO_LANG = {
    '.py': 'python', '.js': 'javascript', '.jsx': 'javascript', 
    '.ts': 'typescript', '.tsx': 'typescript', '.html': 'html', 
    '.css': 'css', '.scss': 'scss', '.json': 'json', '.md': 'markdown', 
    '.rs': 'rust', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml',
    '.sh': 'bash', '.bat': 'batch', '.c': 'c', '.cpp': 'cpp', 
    '.java': 'java', '.sql': 'sql', '.xml': 'xml'
}

IGNORAR_DIRS = [
    'node_modules', 'venv', '.venv', '.git', '.vscode', '__pycache__',
    'dist', 'build', 'docs', 'managed_components', 'target', 'src-tauri/gen'
]

IGNORAR_ARQUIVOS = [
    '.gitignore', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'images.py', 'log_uart.py', 'leitor.py', 'leitor_diff.py', 
    'leitor_diff_md.py', 'leitor_diff_v3.py', 'sdkconfig'
]

IGNORAR_EXTENSOES = [
    '.pyc', '.pyo', '.pyd', '.so', '.dll', '.exe', '.rlib', '.rmeta',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.mp3', '.wav', '.flac', '.mp4', '.mkv', '.avi',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.db', '.sqlite3', '.lock', '.pdb', '.icns'
]

# --- FUNÇÕES ---

def get_git_branch(repo_path):
    git_dir = os.path.join(repo_path, '.git')
    if not os.path.isdir(git_dir): return None

    try:
        cmd = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']
        result = subprocess.run(
            cmd, cwd=repo_path, capture_output=True, text=True, encoding='utf-8',
            check=False, errors='ignore', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        branch_name = result.stdout.strip()

        if branch_name == 'HEAD':
            cmd_hash = ['git', 'rev-parse', '--short', 'HEAD']
            result_hash = subprocess.run(
                cmd_hash, cwd=repo_path, capture_output=True, text=True, encoding='utf-8',
                check=False, errors='ignore', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            return f"detached_{result_hash.stdout.strip()}"
        
        return branch_name.replace('/', '_').replace('\\', '_')

    except Exception:
        return None

def ler_arquivo(caminho):
    """Tenta ler arquivo com UTF-8, fallback para Latin-1."""
    try:
        with open(caminho, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        try:
            with open(caminho, 'r', encoding='latin-1') as f:
                return f.read()
        except:
            return None
    except:
        return None

def gerar_markdown_contexto_total():
    try:
        DIRETORIO_SCRIPT_ABS = os.path.dirname(os.path.abspath(sys.argv[0]))
        caminho_base_abs = os.path.abspath(os.path.join(DIRETORIO_SCRIPT_ABS, DIRETORIO_ALVO))

        nome_pasta_alvo = os.path.basename(caminho_base_abs)
        nome_branch = get_git_branch(caminho_base_abs)
        
        suffix = f"_{nome_branch}" if nome_branch else ""
        ARQUIVO_SAIDA = f'contexto_TOTAL_{nome_pasta_alvo}{suffix}.md'
        
        caminho_saida_abs = os.path.abspath(os.path.join(DIRETORIO_SCRIPT_ABS, ARQUIVO_SAIDA))

        print(f"Iniciando varredura em: {caminho_base_abs}")
        print(f"Arquivo alvo: {ARQUIVO_SAIDA}")

        # Adiciona script atual e saída aos ignorados
        meu_nome = os.path.basename(sys.argv[0])
        if meu_nome not in IGNORAR_ARQUIVOS: IGNORAR_ARQUIVOS.append(meu_nome)
        if ARQUIVO_SAIDA not in IGNORAR_ARQUIVOS: IGNORAR_ARQUIVOS.append(ARQUIVO_SAIDA)

        conteudo_dos_arquivos = []
        pastas_ignoradas_set = set()
        arquivos_ignorados = []

        IGNORAR_DIRS_NORM = [d.replace('\\', '/') for d in IGNORAR_DIRS]

        for dirpath, dirnames, filenames in os.walk(caminho_base_abs, topdown=True):
            
            # 1. Filtro de Diretórios
            dirs_para_manter = []
            for d in dirnames:
                caminho_absoluto_dir = os.path.join(dirpath, d)
                caminho_relativo_dir = os.path.relpath(caminho_absoluto_dir, caminho_base_abs).replace('\\', '/')
                
                ignorar = False
                if d in IGNORAR_DIRS:
                    ignorar = True
                if not ignorar:
                    for regra in IGNORAR_DIRS_NORM:
                        if caminho_relativo_dir == regra or caminho_relativo_dir.startswith(regra + '/'):
                            ignorar = True
                            break
                
                if ignorar:
                    pastas_ignoradas_set.add(caminho_relativo_dir)
                else:
                    dirs_para_manter.append(d)
            
            dirnames[:] = dirs_para_manter

            # 2. Processamento de Arquivos
            for filename in filenames:
                caminho_completo = os.path.join(dirpath, filename)
                if caminho_completo == caminho_saida_abs: continue
                
                caminho_rel = os.path.relpath(caminho_completo, caminho_base_abs)
                caminho_rel_norm = caminho_rel.replace('\\', '/')

                if (filename in IGNORAR_ARQUIVOS or
                        any(filename.endswith(ext) for ext in IGNORAR_EXTENSOES)):
                    arquivos_ignorados.append(caminho_rel_norm)
                    continue

                # Verificação de metadado (evitar ler logs antigos)
                eh_log = False
                try:
                    with open(caminho_completo, 'r', encoding='utf-8', errors='ignore') as f:
                        l = f.readline().strip()
                        if l == METADATA_TAG or "CONTEXTO_GERADO" in l:
                            eh_log = True
                except: pass

                if eh_log:
                    arquivos_ignorados.append(f"{caminho_rel_norm} [LOG ANTERIOR]")
                    continue

                # Leitura com fallback
                print(f"Lendo: {caminho_rel_norm}")
                conteudo = ler_arquivo(caminho_completo)
                
                if conteudo is not None:
                    conteudo_dos_arquivos.append((caminho_rel_norm, conteudo))
                else:
                    print(f"⚠️ Erro/Binário: {caminho_rel_norm}")
                    arquivos_ignorados.append(f"{caminho_rel_norm} [ERRO LEITURA]")

        # --- GERAÇÃO DO ARQUIVO MARKDOWN ---
        print(f"\nEscrevendo Markdown...")
        with open(caminho_saida_abs, 'w', encoding='utf-8') as f_out:
            f_out.write(f"{METADATA_TAG}\n\n")
            f_out.write(f"# Contexto Completo: {nome_pasta_alvo}\n\n")
            
            f_out.write("> **Info**\n")
            f_out.write(f"> - **Data:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f_out.write(f"> - **Branch:** `{nome_branch if nome_branch else 'N/A'}`\n")
            f_out.write(f"> - **Total Arquivos:** {len(conteudo_dos_arquivos)}\n\n")

            f_out.write("---\n\n")
            
            # Seção de Ignorados (Resumida)
            if pastas_ignoradas_set or arquivos_ignorados:
                f_out.write("### 🙈 Estrutura Ignorada (Resumo)\n")
                if pastas_ignoradas_set:
                    f_out.write(f"- {len(pastas_ignoradas_set)} pastas ignoradas (ex: `node_modules`, `dist`...)\n")
                if arquivos_ignorados:
                     f_out.write(f"- {len(arquivos_ignorados)} arquivos ignorados/filtrados\n")
                f_out.write("\n---\n\n")

            f_out.write("# 💻 Conteúdo dos Arquivos\n\n")

            for caminho_rel, conteudo in sorted(conteudo_dos_arquivos):
                nome_arquivo = os.path.basename(caminho_rel)
                extensao = os.path.splitext(nome_arquivo)[1].lower()
                linguagem = EXTENSION_TO_LANG.get(extensao, '')
                
                f_out.write(f"## 📄 {caminho_rel}\n\n")
                f_out.write(f"```{linguagem}\n")
                f_out.write(conteudo)
                if not conteudo.endswith('\n'):
                    f_out.write('\n')
                f_out.write("```\n\n")

        print(f"✅ Concluído! Arquivo gerado: {ARQUIVO_SAIDA}")

    except Exception as e:
        print(f"❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    gerar_markdown_contexto_total()