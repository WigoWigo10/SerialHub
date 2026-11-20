import os
import sys
from datetime import datetime
import subprocess

# --- CONFIGURAÇÕES ---

METADATA_TAG = ""
DIRETORIO_ALVO = '.'

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
    'dist', 'build', 'docs', 'managed_components', 'target'
]

IGNORAR_ARQUIVOS = [
    '.gitignore', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'images.py', 'log_uart.py', 'leitor.py', 'leitor_diff.py', 'leitor_diff_md.py', 'leitor_diff_v3.py',
    'sdkconfig'
]

IGNORAR_EXTENSOES = [
    '.pyc', '.pyo', '.pyd', '.so', '.dll', '.exe',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.mp3', '.wav', '.flac', '.mp4', '.mkv', '.avi',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.db', '.sqlite3', '.lock'
]

# --- FUNÇÕES ---

def run_git_command(cmd, cwd):
    try:
        # check=False para não estourar erro se o git retornar status code diferente de 0 (ex: diff vazio)
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8',
            check=False, errors='ignore',
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        if result.returncode != 0 and result.stderr:
            # Apenas debug leve se falhar
            return None
        return result.stdout.strip()
    except Exception:
        return None

def get_git_branch(repo_path):
    git_dir = os.path.join(repo_path, '.git')
    if not os.path.isdir(git_dir): return None
    
    out = run_git_command(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repo_path)
    if not out: return None
    
    if out == 'HEAD':
        hash_short = run_git_command(['git', 'rev-parse', '--short', 'HEAD'], repo_path)
        return f"detached_{hash_short}" if hash_short else "detached"
    
    return out.replace('/', '_').replace('\\', '_')

def get_git_status_items(repo_path):
    """
    Retorna lista de (status, caminho_relativo)
    """
    if not os.path.isdir(os.path.join(repo_path, '.git')):
        print("❌ ERRO: Não é um repositório Git.")
        return []

    # --porcelain garante formato estável para scripts
    out = run_git_command(['git', 'status', '--porcelain'], repo_path)
    if not out: return []

    itens = []
    
    for linha in out.splitlines():
        if len(linha) < 3: continue
        
        # Pega status (2 chars)
        raw_status = linha[:2]
        
        # CORREÇÃO 1: Pega o caminho a partir do índice 2 e faz strip.
        # Isso resolve o problema de 'ackage-lock.json' e caminhos com aspas.
        caminho_raw = linha[2:].strip()
        
        # Remove aspas que o git coloca em nomes com espaço/especiais
        if caminho_raw.startswith('"') and caminho_raw.endswith('"'):
            caminho_raw = caminho_raw[1:-1]

        # Trata renomeação: "old -> new"
        if '->' in caminho_raw:
            parts = caminho_raw.split('->')
            caminho_final = parts[-1].strip()
            if caminho_final.startswith('"') and caminho_final.endswith('"'):
                caminho_final = caminho_final[1:-1]
        else:
            caminho_final = caminho_raw

        # Ignora Deletados (D)
        if 'D' in raw_status: continue

        status_simples = 'NOVO' if ('??' in raw_status or 'A' in raw_status) else 'MODIFICADO'
        itens.append((status_simples, caminho_final))

    return itens

def get_file_diff(repo_path, file_rel_path):
    cmd = ['git', 'diff', 'HEAD', '--no-color', '--', file_rel_path]
    return run_git_command(cmd, repo_path)

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

def gerar_markdown_diff_v3():
    try:
        DIRETORIO_SCRIPT_ABS = os.path.dirname(os.path.abspath(sys.argv[0]))
        caminho_base_abs = os.path.abspath(os.path.join(DIRETORIO_SCRIPT_ABS, DIRETORIO_ALVO))

        nome_pasta_alvo = os.path.basename(caminho_base_abs)
        nome_branch = get_git_branch(caminho_base_abs)
        
        if not nome_branch:
            print("⚠️ Necessário rodar dentro de um repositório Git.")
            return

        print(f"Branch: {nome_branch}")
        ARQUIVO_SAIDA = f'contexto_DIFF_COMPARA_{nome_pasta_alvo}_{nome_branch}.md'
        caminho_saida_abs = os.path.abspath(os.path.join(DIRETORIO_SCRIPT_ABS, ARQUIVO_SAIDA))

        # Evita auto-leitura
        nome_script = os.path.basename(sys.argv[0])
        if nome_script not in IGNORAR_ARQUIVOS: IGNORAR_ARQUIVOS.append(nome_script)
        if ARQUIVO_SAIDA not in IGNORAR_ARQUIVOS: IGNORAR_ARQUIVOS.append(ARQUIVO_SAIDA)

        lista_git = get_git_status_items(caminho_base_abs)

        if not lista_git:
            print("✅ Nenhuma alteração pendente.")
            return
        
        print(f"Detectados {len(lista_git)} itens no Git.")

        buffer_saida = []
        arquivos_ignorados_log = []
        arquivos_processados_count = 0

        # Fila de processamento para lidar com recursão de pastas novas
        fila_processamento = lista_git.copy()

        processed_paths = set() # Evita duplicatas se houver recursão maluca

        while fila_processamento:
            status, caminho_rel = fila_processamento.pop(0)
            
            caminho_rel_norm = caminho_rel.replace('\\', '/')
            if caminho_rel_norm in processed_paths: continue
            processed_paths.add(caminho_rel_norm)

            caminho_completo = os.path.join(caminho_base_abs, caminho_rel)
            path_parts = caminho_rel_norm.split('/')
            filename = path_parts[-1]

            # --- FILTROS BÁSICOS ---
            if any(part in IGNORAR_DIRS for part in path_parts):
                arquivos_ignorados_log.append(f"{caminho_rel_norm} [PASTA IGNORADA]")
                continue
            
            # --- CORREÇÃO 2: TRATAMENTO DE DIRETÓRIOS NOVOS ---
            if os.path.isdir(caminho_completo):
                # Se o Git reportou uma pasta (Untracked), adicionamos todos os arquivos dela na fila
                print(f"📂 Expandindo pasta nova: {caminho_rel_norm}")
                try:
                    for root, dirs, files in os.walk(caminho_completo):
                        # Remove pastas ignoradas da recursão
                        dirs[:] = [d for d in dirs if d not in IGNORAR_DIRS]
                        
                        for file in files:
                            if file in IGNORAR_ARQUIVOS: continue
                            
                            f_path_abs = os.path.join(root, file)
                            f_path_rel = os.path.relpath(f_path_abs, caminho_base_abs)
                            
                            # Adiciona na fila como 'NOVO'
                            fila_processamento.append(('NOVO', f_path_rel))
                except Exception as e:
                    print(f"Erro ao expandir pasta {caminho_rel}: {e}")
                continue

            # --- FILTROS DE ARQUIVO ---
            if (filename in IGNORAR_ARQUIVOS or 
                any(filename.endswith(ext) for ext in IGNORAR_EXTENSOES)):
                arquivos_ignorados_log.append(f"{caminho_rel_norm} [FILTRO EXT/NOME]")
                continue
            
            if not os.path.exists(caminho_completo):
                print(f"❌ Arquivo não encontrado: {caminho_rel_norm}")
                continue

            # --- CORREÇÃO 3: VERIFICAÇÃO DE LOG MENOS AGRESSIVA ---
            eh_log_anterior = False
            try:
                with open(caminho_completo, 'r', encoding='utf-8', errors='ignore') as f:
                    primeira_linha = f.readline().strip()
                    # Só ignora se a primeira linha FOR EXATAMENTE a tag de metadado
                    if primeira_linha == METADATA_TAG or primeira_linha == "":
                        eh_log_anterior = True
            except: pass

            if eh_log_anterior:
                arquivos_ignorados_log.append(f"{caminho_rel_norm} [LOG ANTERIOR]")
                continue

            # --- LEITURA E GERAÇÃO DO BLOCO ---
            print(f"Processando: {caminho_rel_norm} ({status})")
            conteudo_atual = ler_arquivo(caminho_completo)

            if conteudo_atual is None:
                arquivos_ignorados_log.append(f"{caminho_rel_norm} [ERRO LEITURA/BINÁRIO]")
                continue

            extensao = os.path.splitext(filename)[1].lower()
            linguagem = EXTENSION_TO_LANG.get(extensao, '')

            bloco = ""
            bloco += f"## 📄 {caminho_rel_norm} "
            
            if status == 'NOVO':
                bloco += "*(Novo / Untracked)*\n\n"
                bloco += f"```{linguagem}\n{conteudo_atual}\n```\n\n"
            
            elif status == 'MODIFICADO':
                bloco += "*(Modificado)*\n\n"
                diff_text = get_file_diff(caminho_base_abs, caminho_rel)
                
                if diff_text:
                    bloco += "### 🔍 Alterações (Git Diff)\n"
                    bloco += f"```diff\n{diff_text}\n```\n\n"
                else:
                    bloco += "> *Diff vazio (possível mudança de permissão ou fim de linha).*\n\n"
                
                bloco += "### 📝 Conteúdo Atualizado\n"
                bloco += f"```{linguagem}\n{conteudo_atual}\n```\n\n"

            buffer_saida.append(bloco)
            arquivos_processados_count += 1

        # --- ESCRITA FINAL ---
        print(f"\nEscrevendo relatório em Markdown...")
        with open(caminho_saida_abs, 'w', encoding='utf-8') as f_out:
            f_out.write(f"{METADATA_TAG}\n\n")
            f_out.write(f"# 📊 Relatório de Alterações: {nome_pasta_alvo}\n\n")
            f_out.write(f"> **Info**\n")
            f_out.write(f"> - **Data:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f_out.write(f"> - **Branch:** `{nome_branch}`\n")
            f_out.write(f"> - **Arquivos Processados:** {arquivos_processados_count}\n\n")

            if arquivos_ignorados_log:
                f_out.write("### 🙈 Ignorados / Filtrados\n")
                # Limita a 20 linhas para não poluir se tiver muito lixo
                for i, item in enumerate(arquivos_ignorados_log):
                    if i < 20:
                        f_out.write(f"- `{item}`\n")
                    else:
                        f_out.write(f"- ... e mais {len(arquivos_ignorados_log) - 20} itens.\n")
                        break
                f_out.write("\n---\n\n")

            if not buffer_saida:
                f_out.write("✅ **Nenhum arquivo válido encontrado.**\n")
            else:
                for bloco in buffer_saida:
                    f_out.write(bloco)
                    f_out.write("---\n\n")

        print(f"✅ Sucesso! Arquivo gerado: {ARQUIVO_SAIDA}")

    except Exception as e:
        print(f"❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    gerar_markdown_diff_v3()