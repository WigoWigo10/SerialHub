# Evidências históricas

Os arquivos desta pasta registram resultados nas referências e datas descritas nos documentos PAIC correspondentes. Não representam automaticamente o resultado do código atual.

- `etapa-08-baseline.json` e `etapa-08-gui-resultados.json`: reprodução anterior e verificações sintéticas da GUI; consulte as ressalvas de encoding e ausência de comunicação Serial nativa em `../etapa-08-auditoria-serial-arquivos.md`.
- `auditoria-estado-atual-*.json`: resultados da auditoria de 20/10/2026, anteriores às correções A01–A06. Rótulos `Virtual` nesse registro não comprovam virtualização. Os relatórios npm são históricos e não substituem uma nova auditoria.
- `auditoria-estado-atual-probes.mjs`: reprodução das funções anteriores à correção, na referência `fc4bf32` examinada pela auditoria. Deve ser usada com aquela implementação; não é um teste da implementação atual. As regressões atuais estão em `tests/`.

O diretório local `auditoria-estado-atual-portas/` não foi incluído neste commit porque contém identificadores de hardware. O resumo relevante permanece na auditoria e na correção A06: COM3 foi identificada anteriormente como Intel AMT SOL; nenhum par virtual foi confirmado e nenhuma porta foi aberta nessas enumerações.
