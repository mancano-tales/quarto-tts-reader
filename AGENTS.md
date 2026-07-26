# CLAUDE.md / AGENTS.md — quarto-tts-reader

> 🚨 **CRITICAL AGENT RULES (COVENANT) — READ FIRST:**
> - **RULE 1:** Every commit is audited. Never commit without the verification of § "Verificação obrigatória" passing.
> - **RULE 2:** Any change to `_extensions/` REQUIRES an entry in `NEWS.md` **in the same commit**.
> - **RULE 3:** Never edit `AGENTS.md` by hand — it is a mirror of this file. Edit `CLAUDE.md` only.
> - **RULE 4:** Never claim the player works without rendering `example.qmd`. Audio behaviour cannot be verified by reading code; see § "O que agentes NÃO conseguem verificar".
> - **For humans:** this file is AI operating context. See [README.md](README.md).

---

## Estado atual do projeto (versão de 2026-07-26)

> **Esta seção é a única fonte de verdade sobre a concepção ATUAL da extensão.** Mudanças de desenho são registradas aqui com a data. Qualquer coisa em conflito com esta seção (entradas antigas do `NEWS.md`, comentários velhos) é documentação histórica, não orientação.

- **O que é**: extensão Quarto que injeta um player de leitura em voz alta (Web Speech API) em documentos HTML. Serve para o autor **ouvir o próprio texto enquanto o edita** — é ferramenta de escrita, não recurso de publicação.
- **Procedência**: o código nasceu como bloco `{=html}` dentro de um capítulo da dissertação de mestrado do autor (`Mancano2026-MA-Thesis`, capítulo `0102`) e foi extraído para cá em 2026-07-26. Passou por quatro rodadas de auditoria cruzada entre agentes de IA antes da extração; os defeitos encontrados estão registrados no `NEWS.md` e a maioria virou comentário explicativo no ponto do código onde importa. **Não "limpe" esses comentários** — eles são a razão de o código não ter voltado a quebrar.
- **Superfície pública**: uma flag de metadado, `tts-reader-enabled` (default **`false`**). Nada mais. A extensão não altera o documento; só carrega JS e CSS.
- **Dois guardas invioláveis** (ambos em `tts-reader.lua`):
  1. `quarto.doc.is_format('html:js')` — o sufixo `:js` é deliberado e **verificado**: restringe a formatos HTML que suportam JavaScript. Trocar por `'html'` é regressão (uma auditoria externa sugeriu isso em 2026-07-26 alegando que `html:js` seria inválido; é falso, o identificador aparece no próprio Lua que o Quarto instala).
  2. `tts-reader-enabled` com default `false` — o player é auxílio de rascunho e **não pode vazar para um site publicado**. Nunca inverta esse default.
- **Regra de layout do CSS**: as classes de destaque são ligadas e desligadas palavra a palavra, muitas vezes por segundo. Elas **não podem alterar a caixa da palavra** — nada de `padding` horizontal, margem, borda ou `font-weight` mais pesado, que refluem a linha e fazem o texto saltar enquanto se lê. Use `box-shadow`, que pinta fora da caixa sem participar do layout.
- **Preparação sob demanda**: as palavras são envolvidas em `<span>` quando o bloco é necessário (ponteiro sobre ele, clique, ou a leitura chegando nele), nunca no carregamento. **Não substitua isso por `MutationObserver`**: envolver palavras é ela mesma uma mutação do DOM, e o observer dispararia com as próprias escritas, em loop.
- **Proibições estritas**:
  - Nunca reconstruir um bloco a partir de `innerText`/`innerHTML` para envolver palavras — isso destrói links de citação, itálicos e notas. Use a travessia com `TreeWalker`.
  - Nunca derivar posição de caractere somando o comprimento dos `<span>` — o espaço em branco vive fora deles e a soma desvia um caractere por palavra. Use o `data-offset` gravado.
  - Nunca usar `git add .` ou `git add -A`. Adicione só os arquivos em que trabalhou.
  - Nunca fazer commit de `example.html` ou `example_files/` (são gerados; estão no `.gitignore`).

---

## Verificação obrigatória (antes de qualquer commit em `_extensions/`)

Mecânica, e não negociável:

```bash
node --check _extensions/tts-reader/tts-reader.js     # sintaxe do JS

quarto render example.qmd --to html                    # flag ON  (o exemplo traz true)
grep -c '<script[^>]*tts-reader\|<link[^>]*tts-reader' example.html   # deve dar 2

quarto render example.qmd --to html -M tts-reader-enabled=false
grep -c '<script[^>]*tts-reader\|<link[^>]*tts-reader' example.html   # deve dar 0
```

O segundo par é o que protege sites publicados. Se ele der qualquer coisa diferente de `0`, **não commite** — o guard quebrou.

## O que agentes NÃO conseguem verificar

Nenhum agente aqui reproduz áudio nem clica em botão. Render limpo e sintaxe válida **não** dizem que o player funciona. Só o humano verifica: se a fala começa, se pause/resume retoma perto de onde parou, se o clique numa palavra começa dali, se o texto não salta enquanto as palavras acendem, se o epígrafe é lido uma vez só, e se uma voz "Natural"/"Online" degrada para destaque do bloco inteiro em vez de travar.

**Nunca escreva que o player "está funcionando" com base em render.** Escreva o que foi verificado (sintaxe, injeção, guard) e o que continua por verificar.

---

## Convenções de Git e documentação para agentes

- **Commits permitidos**: agentes podem commitar em `_extensions/`, `example.qmd` e documentos de governança, desde que a verificação obrigatória passe.
- **Staging cirúrgico**: `git add <arquivo>`, nunca `git add .`.
- **Co-commit sincronizado**: toda mudança funcional entra no mesmo commit que a entrada correspondente do `NEWS.md`. Não separe a mudança do seu registro — é isso que impede deriva histórica.
- **`git commit --only <arquivos>`** quando houver qualquer coisa staged que não seja assunto do commit. Um `git commit` sem pathspec leva tudo que está no index, inclusive trabalho alheio em curso.
- Toda entrada do `NEWS.md` escrita por agente termina com:

```markdown
**Metadados de Execução**:
- **Data/Hora**: YYYY-MM-DD HH:MM (Horário Local)
- **Agente**: [Nome] / [Modelo] / [Plataforma]
- **Mensagem do Commit**: "sua mensagem aqui"
- **Arquivos afetados**: caminho/1, caminho/2
```

### Rigor de timestamp — e o gotcha que já corrompeu registros

Todo timestamp (cabeçalho de entrada `## YYYY-MM-DD HH:MM — Título` e o campo `**Data/Hora**`) exige **hora e minuto**, no Horário de Brasília (UTC-3, sem horário de verão). Data sozinha não basta.

> 🚨 **`TZ='America/Sao_Paulo'` NÃO FUNCIONA no Git Bash do Windows e devolve UTC em silêncio** (verificado em 2026-07-26). Todo timestamp obtido assim fica **3h adiantado**. Esse erro corrompeu entradas de `NEWS.md` no repositório da dissertação por bastante tempo antes de ser notado.
>
> ```bash
> date '+%Y-%m-%d %H:%M'          # ✅ correto: já retorna -0300
> TZ='America/Sao_Paulo' date     # ❌ ERRADO: retorna GMT +0000
> ```
>
> **Confira sempre antes de escrever**: `date '+%z'` tem de imprimir `-0300`. Se imprimir `+0000`, o fuso não foi aplicado. Confirmação independente: `git log -1 --date=format:'%Y-%m-%d %H:%M %z'` — divergência de ~3h é este bug, não atraso real.

Se a hora exata não puder ser recuperada com confiança, deixe só a data e explique por quê — **nunca invente um horário**.

---

## Mapa dos documentos

| Documento | Público | Função | Quando atualizar |
|---|---|---|---|
| `CLAUDE.md` (este) | Agentes | Estado ATUAL, convenções, armadilhas | Mudança de concepção |
| `AGENTS.md` | Agentes | Espelho de `CLAUDE.md` — nunca editar à mão | Junto com `CLAUDE.md` |
| `README.md` | Humanos | O que é, como instalar, limitações | Mudança de uso |
| `NEWS.md` | Ambos | Changelog — histórico, nunca reescrito | Toda mudança relevante |
| `TODO.md` | Ambos | Fila de tarefas (Pendente/Prospectivo/Concluído) | Toda sessão que cria ou conclui tarefa |
| `example.qmd` | Ambos | Banco de testes e roteiro de verificação manual | Toda funcionalidade nova |

---

## Estrutura e stack

```
quarto-tts-reader/
├── _extensions/tts-reader/
│   ├── _extension.yml     # metadados; contributes: filters
│   ├── tts-reader.lua     # os dois guardas + injeção dos assets
│   ├── tts-reader.js      # o player
│   └── tts-reader.css     # destaques e barra de controles
├── example.qmd            # ⭐ na RAIZ, não em subpasta (ver abaixo)
├── CLAUDE.md / AGENTS.md / README.md / NEWS.md / TODO.md / LICENSE
```

**Gotcha verificado (2026-07-26): `example.qmd` tem de ficar na raiz do repositório.** Numa subpasta, sem `_quarto.yml`, o Quarto trata a pasta do documento como raiz do projeto, não encontra `_extensions/` e falha com *"Could not find executable …/tts-reader"*, interpretando o nome do filtro como caminho de executável. É a mesma estrutura das extensões oficiais (`quarto-ext/*`).

Sem build, sem dependências, sem gerenciador de pacotes. JavaScript puro (ES5-compatível, sem transpilação), Lua para o filtro, Quarto ≥ 1.4.
