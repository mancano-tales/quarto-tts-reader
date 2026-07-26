# NEWS — quarto-tts-reader

> Entrada mais recente no topo. Histórico: entradas nunca são reescritas.
>
> **Convenção de timestamp**: formato `YYYY-MM-DD HH:MM`, Horário de Brasília (UTC-3, sem horário de verão). Data sozinha não é suficiente. **Atenção ao gotcha do fuso documentado no `CLAUDE.md`** — `TZ='America/Sao_Paulo'` devolve UTC no Git Bash do Windows; use `date` puro e confira que `%z` imprime `-0300`.

## 2026-07-26 07:43 — Extração da dissertação e primeiro commit

Primeira versão da extensão. O código **não nasceu aqui**: veio de um bloco `{=html}` de ~520 linhas embutido no capítulo da Parte I da dissertação de mestrado do autor (`Mancano2026-MA-Thesis`, `3-texts/0102-.../Mancano2026-0102-MA-Theoretical-Framework.qmd`), onde tinha três problemas estruturais — funcionava só naquele capítulo, ficava exposto a edição acidental no meio da prosa (um typo `textContentds` chegou a entrar no index do git por uma tecla perdida), e iria ao ar no site público da tese num `publish` descuidado. Extraído conforme o plano `9-vers/plan/2026-07-26_Plano_Extracao_TTS_Reader_Extensao_Quarto.md` daquele repositório.

**Registro de procedência (não apagar):** antes da extração, o player passou por quatro rodadas de auditoria cruzada entre agentes de IA, e os defeitos encontrados moldaram o desenho atual. Vale listar, porque cada um virou uma decisão de código que parece arbitrária sem esta história:

1. A primeira versão reconstruía cada parágrafo a partir de `innerText` para envolver as palavras, o que **destruía toda a marcação a cada carregamento** — inclusive os links de citação (13 só no trecho verificado), itálicos e notas. Daí a travessia com `TreeWalker` sobre nós de texto.
2. As posições de destaque somavam o comprimento das palavras, enquanto o `onboundary` reporta coordenadas **com** os espaços — desvio de um caractere por palavra, apontando a palavra errada já na terceira. Daí o `data-offset` absoluto gravado na mesma travessia que constrói o texto falado, o que faz as duas coordenadas concordarem por construção.
3. `onend`/`onerror` tardios de utterances canceladas passavam pelos guards e faziam pular parágrafo. Daí a checagem de identidade `activeUtterance !== u`.
4. O contador de retry do watchdog era zerado pela própria chamada que deveria limitar, tornando o retry infinito. Daí o contador viajar como argumento.
5. `<blockquote><p>` casava duas vezes no seletor, fazendo todo epígrafe ser **lido duas vezes** e envolvido em spans aninhados. Daí o filtro que só aceita blocos folha.
6. O watchdog de travamento retomava do último offset mesmo sem progresso, o que com vozes remotas (que muitas vezes não disparam `onboundary`) **replicava o mesmo parágrafo a cada 3 segundos, indefinidamente**. Daí a exigência de progresso comprovado.
7. O CSS de destaque usava `padding` horizontal e `font-weight: bold` palavra a palavra, o que mudava a largura de cada palavra ao acender e **refluía a linha inteira** — o texto saltava durante a leitura. Daí a regra de layout que proíbe alterar a caixa da palavra, e o uso de `box-shadow`.

**Mudanças de desenho feitas na extração**, aprovadas por auditoria e não presentes na versão da dissertação: a barra de controles passa a ser construída em JavaScript (`createElement`) com `position: fixed`, em vez de HTML escrito à mão com `sticky` — o container do Quarto pode anular `sticky` num filho, e construir em JS dispensa `include-before-body`, cujo ponto de inserção é imprevisível. A preparação das palavras passa a ser **sob demanda** (ponteiro, clique, ou chegada da leitura) em vez de no carregamento; a alternativa considerada, um `MutationObserver`, foi **rejeitada por raciocínio**: envolver palavras é ela mesma uma mutação, e o observer dispararia com as próprias escritas, em loop. Acrescentado o fallback para vozes sem `onboundary` — se nenhum limite de palavra chega em 800ms, destaca-se o bloco inteiro em vez de deixar a interface parada parecendo travada. E o texto canônico passa a normalizar espaço em branco, o que elimina as quebras de linha que o Quarto insere no fonte HTML e que antes fragmentavam o destaque de frase em pontos sem sentido.

**Dois achados empíricos desta sessão, ambos contrariando auditoria externa e ambos verificados com render de verdade:**

- `quarto.doc.is_format('html:js')` **é válido** — uma auditoria alegou que o identificador não existiria e que o correto seria `'html'`. O identificador aparece no Lua que o próprio Quarto instala, e o sufixo `:js` é justamente o que exclui formatos HTML sem suporte a JavaScript.
- Os campos de `add_html_dependency` são `scripts`/`stylesheets` **no plural**, e a forma `{ path = ..., attribs = { defer = 'true' } }` funciona: o HTML gerado traz `defer="true"`. A mesma auditoria afirmara serem singulares, sem evidência.

E um erro meu, descoberto do jeito certo — rodando antes de escrever: **`example.qmd` tem de ficar na raiz do repositório.** Numa subpasta, sem `_quarto.yml`, o Quarto trata a pasta do documento como raiz do projeto, não acha `_extensions/` e falha com *"Could not find executable …/tts-reader"*, interpretando o nome do filtro como caminho de executável. Corrigido movendo o arquivo, que é como as extensões oficiais fazem.

**Verificado nesta sessão** (mecânico): sintaxe do JS por `node --check`; render do exemplo sem erro; assets copiados para `example_files/libs/quarto-contrib/tts-reader-1.0.0/`; `defer="true"` presente na tag; e o guard de publicação testado nos dois sentidos — **2 tags com a flag ligada, 0 com ela desligada**.

**NÃO verificado**: absolutamente todo o comportamento de áudio. Nenhum agente reproduz som nem clica em botão. Se a fala começa, se o pause retoma no lugar certo, se o clique numa palavra funciona, se o texto não salta, se o epígrafe é lido uma vez, se a degradação com voz remota funciona — tudo isso continua por verificar pelo autor, seguindo o roteiro escrito no `example.qmd`.

**Metadados de Execução**:
- **Data/Hora**: 2026-07-26 07:43 (Horário Local)
- **Agente**: Claude Code / Claude Opus 5 / VS Code
- **Mensagem do Commit**: "feat: extensao Quarto de leitura em voz alta, extraida da dissertacao"
- **Arquivos afetados**: `_extensions/tts-reader/{_extension.yml,tts-reader.lua,tts-reader.js,tts-reader.css}`, `example.qmd`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `NEWS.md`, `TODO.md`, `LICENSE`, `.gitignore`
