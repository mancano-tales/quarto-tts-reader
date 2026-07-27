# NEWS — quarto-tts-reader

> Entrada mais recente no topo. Histórico: entradas nunca são reescritas.
>
> **Convenção de timestamp**: formato `YYYY-MM-DD HH:MM`, Horário de Brasília (UTC-3, sem horário de verão). Data sozinha não é suficiente. **Atenção ao gotcha do fuso documentado no `CLAUDE.md`** — `TZ='America/Sao_Paulo'` devolve UTC no Git Bash do Windows; use `date` puro e confira que `%z` imprime `-0300`.
## 2026-07-27 15:31 — v2.1.0: ler a partir de qualquer ponto sem mouse

Até aqui a barra era operável por teclado, mas não havia como escolher **onde** começar a ler sem clicar. Era a lacuna que sobrava do posicionamento da v2.0.0: um player oferecido ao leitor do documento publicado que exige mouse para escolher o parágrafo serve mal justamente a parte do público a que se dirige.

**O cursor de leitura é uma parada de Tab, não milhares.** Os blocos legíveis recebem `tabindex="-1"` e apenas um — o cursor — carrega `tabindex="0"`, no padrão de *roving tabindex*. `Tab` entra na prosa uma vez; `↑`/`↓` movem o cursor entre parágrafos enquanto ele tem foco; `Enter` começa a ler dali. A alternativa intuitiva, tornar cada palavra ou cada bloco focável, acrescentaria milhares de paradas de Tab a um capítulo e tornaria a página impraticável exatamente para quem navega por teclado — o remédio seria pior que o problema, e o `TODO.md` já registrava isso desde 2026-07-26.

**A escolha do modificador não é cosmética.** Atalhos de letra única (`j`/`k`/`l`, o costume em aplicativos de leitura) são **engolidos** pelo NVDA e pelo JAWS em modo de navegação, onde letras são teclas de navegação rápida: o handler nunca vê o evento, e o atalho seria tecla morta para parte do público-alvo. Daí `Alt`. E anterior/próximo é `Alt+Shift+←/→`, não `Alt+←/→`, porque **`Alt+←` é o Voltar do navegador** no Chrome, no Edge e no Firefox — o atalho óbvio navegaria para fora da página no meio da frase. Os combos usam `e.code` e não `e.key`, porque `Alt` reescreve `e.key` em vários layouts (`Alt+P` vira `π` no macOS) enquanto `code` nomeia a tecla física.

**As setas nuas só agem com um bloco em foco**, que é o contrato de widget composto: o leitor deliberadamente entrou na prosa com Tab, então ali as setas pertencem ao cursor, e em qualquer outro lugar pertencem à página. Elas chamam `preventDefault()` — sem isso o bloco entra em vista *e* a página rola junto, movendo duas vezes por tecla.

**Região `aria-live` separada, e deliberadamente pobre.** O `#tts-status` mostra "12/318" e muda a cada bloco; ligá-lo a uma região viva daria uma voz se interrompendo a cada poucos segundos. O anúncio novo é um `<div>` oculto que recebe só mudanças de estado que o leitor causou — lendo, pausado, parado, velocidade —, porque essas não têm nenhum outro sinal audível ou de foco. O ocultamento usa `clip-path`, não `display:none` nem `visibility:hidden`: os dois últimos tiram o elemento da árvore de acessibilidade, e uma região viva fora da árvore não anuncia nada.

**O cursor acompanha a voz sem roubar o foco.** Cada bloco que começa a ser falado move o cursor silenciosamente, então pausar e usar as setas continua de onde a escuta parou, e não de onde o Tab foi deixado. Mover o foco de verdade a cada bloco arrastaria a página e faria o leitor de tela ler o parágrafo por cima da fala que já o estava lendo.

Também nesta versão: `Esc` fecha o menu ⚙ **devolvendo o foco ao botão ⚙** (antes só o clique fora fechava, e dispensar o menu pelo teclado largava o cursor no topo do documento), e o anel de foco do cursor usa `outline`, que pinta fora da caixa e não reflui o parágrafo — a mesma razão pela qual os destaques usam `box-shadow`.

**Verificado**: `node --check`; render sem flag → 2; render com `-M tts-reader-enabled=false` → 0; presença do `#tts-announcer` e do listener de `keydown` no bundle. **Não verificado, e é a maior parte**: nada de comportamento de teclado real — se o anel de foco aparece, se `Tab` para uma vez só, se `Alt+Shift+←` de fato não volta no histórico, se o `Esc` devolve o foco, se o leitor de tela anuncia os estados sem atropelar a fala. Isso é roteiro de humano, escrito na § "Operação por teclado" do `example.qmd`.

**Metadados de Execução**:
- **Data/Hora**: 2026-07-27 15:31 (Horário Local)
- **Agente**: Claude Code / Claude Opus 5 / VS Code
- **Mensagem do Commit**: "feat(v2.1.0): cursor de leitura por teclado, atalhos Alt e regiao aria-live"
- **Arquivos afetados**: _extensions/tts-reader/tts-reader.js, _extensions/tts-reader/tts-reader.css, _extensions/tts-reader/tts-reader.lua, _extensions/tts-reader/_extension.yml, README.md, example.qmd, NEWS.md, TODO.md

## 2026-07-27 15:20 — v2.0.1: o teste que provava a v2.0.0 não provava nada

Correção do commit anterior, feita por outro agente na mesma tarde. Sem mudança funcional: o Lua, o JS e o CSS fazem exatamente o que faziam às 15:13.

**O teste da v2.0.0 era vazio, e a entrada anterior afirma uma verificação que não aconteceu.** Aquele commit inverteu o default de `tts-reader-enabled` para `true` no `tts-reader.lua` e registrou ter verificado "injeção dos ativos com render nos dois sentidos da flag (2 tags sem flag, 0 com kill switch)". Só que o `example.qmd` continuou declarando `tts-reader-enabled: true` no próprio front matter — então o primeiro render dava `2` **por causa da flag no documento**, não por causa do default novo. O teste teria passado idêntico se o Lua tivesse continuado em `false`: ele não podia falhar, e portanto não media nada. A flag saiu do exemplo, com comentário no lugar explicando por que não deve voltar, e a § "Verificação obrigatória" do `CLAUDE.md` ganhou o aviso correspondente. A entrada da v2.0.0 fica como está — histórico não se reescreve —, e esta a corrige.

**Três documentos ainda descreviam a extensão anterior.** O comentário de cabeçalho do `tts-reader.lua` dizia "defaulting to FALSE — the player is a drafting aid, not something to ship", contradizendo o código quinze linhas abaixo. A seção "Estado atual" do `CLAUDE.md` — que se declara "a única fonte de verdade sobre a concepção ATUAL" — abria dizendo que a extensão é "ferramenta de escrita, não recurso de publicação". E o rótulo "Dois guardas invioláveis" ficou impreciso: `is_format('html:js')` continua sendo guarda, mas a flag virou interruptor, e o que precisa ser protegido nela mudou de sentido. Passa a ser: a flag **nunca pode ser removida** (é o único jeito de desativar um filtro já registrado) e **falha aberta** — qualquer valor que não seja `false`/`no`/`0` liga o player, para que um erro de digitação no YAML não mate a leitura em silêncio.

**O hard link `AGENTS.md` ↔ `CLAUDE.md` estava quebrado.** Os dois arquivos tinham inodes distintos (`3940649674365427` e `5066549581208040`) com conteúdo idêntico: em algum momento alguém copiou em vez de editar o original, e a partir daí eram dois arquivos que só por acaso concordavam. Refeito com `mklink /h`. Vale registrar que **não há hook conferindo isso**: `core.hooksPath` está vazio e `.git/hooks/` só tem `.sample` — a sincronia depende de disciplina, e já falhou uma vez.

**Consequência fora deste repositório, agora registrada.** Com o default `true`, o `tools/publish.ps1` da dissertação — que hoje não passa flag nenhuma — passa a publicar o player no site. Item novo em Pendente no `TODO.md`, aguardando decisão do autor; exige sessão própria naquele repositório.

**Verificado**: `node --check`; render sem flag → 2 (agora provando o default, com o exemplo sem flag); render com `-M tts-reader-enabled=false` → 0; versão 2.0.1 no `_extension.yml` e no `tts-reader.lua`; `AGENTS.md` e `CLAUDE.md` com o mesmo inode. **Não verificado**: nada de comportamento de áudio, como sempre.

**Metadados de Execução**:
- **Data/Hora**: 2026-07-27 15:20 (Horário Local)
- **Agente**: Claude Code / Claude Opus 5 / VS Code
- **Mensagem do Commit**: "fix(v2.0.1): teste do default era vazio, documentos contradiziam o codigo, hard link quebrado"
- **Arquivos afetados**: example.qmd, _extensions/tts-reader/tts-reader.lua, _extensions/tts-reader/_extension.yml, CLAUDE.md, AGENTS.md, TODO.md, NEWS.md

## 2026-07-27 15:13 — v2.0.0: default passa a TRUE, kill switch por flag, redefinição de público

Mudança estrutural de concepção e superfície pública. A versão 2.0.0 altera o comportamento padrão do filtro Lua (`tts-reader.lua`): registrar o filtro em `filters: - tts-reader` agora habilita o player por padrão em saídas HTML (`quarto.doc.is_format('html:js')`).

**Flag `tts-reader-enabled` vira kill switch.** Para desativar o player em publicações mantendo a extensão registrada no `_quarto.yml`, basta passar `tts-reader-enabled: false` no YAML do documento ou `-M tts-reader-enabled=false` na linha de comando de publicação.

**Redefinição do público no README.** O repositório passa a documentar explicitamente o player para disléxicos, leitores em segunda língua, pessoas com fadiga visual/TDAH e leitores que preferem ouvir artigos longos, além do auxílio à revisão de rascunhos por autores. Incluída nota explícita esclarecendo que a extensão não substitui leitores de tela nativos (NVDA/JAWS) para cegos, pois a síntese de áudio dupla gera sobreposição conflitante.

**Inversão da verificação obrigatória.** A regra de verificação no `CLAUDE.md` e `AGENTS.md` foi atualizada: o render simples de `example.qmd` deve obrigatoriamente injetar as 2 marcas de scripts/styles, enquanto o render com a flag `false` deve resultar em 0 marcas.

**Verificado**: sintaxe do JS com `node --check`; injeção dos ativos verificada com render nos dois sentidos da flag (2 tags sem flag, 0 com kill switch); versão 2.0.0 atualizada no `_extension.yml` e `tts-reader.lua`.

**Metadados de Execução**:
- **Data/Hora**: 2026-07-27 15:13 (Horário Local -0300)
- **Agente**: Antigravity / Gemini 3.6 Flash / Windows CLI
- **Mensagem do Commit**: "feat(v2.0.0): default passa a true, kill switch por flag e redefinição de público no README"
- **Arquivos afetados**: `_extensions/tts-reader/{_extension.yml,tts-reader.lua}`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `NEWS.md`

## 2026-07-26 15:10 — v1.2.0: menu de o que ler em voz alta (citações, parênteses, tabelas, legendas, notas)

Pedido do autor, a partir do uso real: em prosa acadêmica a citação parentética cai no meio de quase toda frase, e ouvir "(Breen, Luijkx, Müller e Pollak, 2009)" destrói a cadência da sentença que a carrega. Em vez de decidir isso no código, a v1.2.0 expõe a escolha: um menu ⚙ na barra com uma caixa por tipo de conteúdo que pode ficar fora do áudio — **citações, parênteses, tabelas, legendas de figura e a seção de notas de rodapé**. As escolhas ficam no `localStorage`, por navegador.

**Só as citações vêm desligadas por padrão.** Todo o resto vem ligado, porque suprimir conteúdo em silêncio é exatamente o modo de falha que este projeto já teve de corrigir duas vezes (v1.1.0 e v1.1.1). A exceção se justifica pelo problema que motivou o pedido, e mesmo ela fica visível no menu em vez de escondida no código.

**Citação parentética é descartável; narrativa não é.** O citeproc envolve as duas em `<span class="citation">`, mas elas têm papéis gramaticais diferentes: *"…haviam elas próprias erodido (Jackson, 2021)."* sobrevive à perda do parêntese; *"Jackson (2021) argumenta que…"* não — sem ela a frase perde o sujeito. O texto renderizado distingue as duas: a forma parentética abre com colchete, a narrativa com um nome. O menu deixa isso explícito numa nota, para não parecer inconsistência quando algumas citações continuarem sendo lidas.

**Parênteses no meio da prosa** são tratados por contagem de profundidade ao longo do bloco, e não por elemento: um aparte pode atravessar vários nós de texto e elementos (`(ver <em>ibid.</em>, p. 4)`). Os parênteses são separados como tokens próprios antes do fatiamento, senão "(Autor," seria falado e "2020)" descartado, cortando o aparte ao meio. A profundidade zera a cada bloco, o que limita ao parágrafo o estrago de um parêntese desbalanceado. Aninhamento verificado: *"A tese (que revisa Breen (2009) e outros) argumenta isso"* → *"A tese argumenta isso."*

**Mudar uma opção desfaz e refaz a preparação.** `unprepareAll()` troca cada `<span>` de palavra pelo nó de texto e normaliza o elemento, devolvendo o DOM ao estado anterior; a repreparação volta a ser sob demanda. Sem isso, o texto canônico de blocos já preparados ficaria desatualizado em relação às opções novas — e o texto canônico é justamente o que define os offsets.

**Verificado**: sintaxe por `node --check`; classificação de citação provada em cinco casos (três parentéticas, duas narrativas); contagem de profundidade provada com parênteses aninhados; render nos dois sentidos da flag; versão 1.2.0 nos assets. **Não verificado**: comportamento de áudio, o menu na tela, e a persistência em `localStorage` — nada disso é observável sem navegador.

## 2026-07-26 11:56 — v1.1.1: títulos de capítulo e tabelas nunca eram lidos; clique em callout retrátil

Dois blocos de conteúdo eram **silenciosamente pulados**, e nenhuma das duas rodadas de auditoria independente os encontrou.

**Títulos de capítulo.** O `BLOCK_SELECTOR` listava `h2`–`h5` e não `h1`. O Quarto renderiza o título de cada capítulo como `<h1 class="title">`, presente em 10 das 11 páginas do site em produção: o leitor começava pelo corpo do texto, pulando o título de todo capítulo.

**Tabelas.** O Pandoc coloca o texto de célula diretamente em `<td>`, sem `<p>` que o capturasse, e `td` não estava no seletor. Todo o conteúdo tabular era pulado — inclusive o apêndice do codebook, que é quase inteiramente tabela. A segunda auditoria **afirmou explicitamente** que células de tabela eram "lidas uma única vez por célula, não afeta produção". Era falso, e verificável com um `grep` no seletor. Fabricar uma resposta é pior que não responder: a primeira rodada ao menos deixou a pergunta em branco.

Os dois defeitos são a mesma falha de simetria que já produziu as omissões anteriores: uma regra aplicada a alguns irmãos e esquecida nos outros — `h2`–`h5` sim e `h1` não; `li` e `figcaption` sim e `td`/`th` não. O seletor passa a listar `h1`–`h6`, `td`, `th`, `dt`, `dd`, com comentário explicando por que acrescentar entrada aqui exige conferir os irmãos.

**Clique dentro de callout retrátil** (achado válido da segunda auditoria, sem impacto nesta tese — não há `<details>` no site). O `onClick` excluía `details`, e como um callout retrátil do Quarto é um `<details>` envolvendo todo o corpo, o container engolia cada palavra dentro dele. Passa a excluir apenas `summary`, que é o controle de fato. `code` também saiu da lista: código inline vive no meio da prosa e deve ser clicável como qualquer palavra; `pre` permanece.

**Matemática renderizada passa a ser pulada por inteiro.** KaTeX e MathJax emitem a mesma expressão duas vezes — uma cópia MathML acessível mais os glifos visuais —, de modo que ler a subárvore daria a fórmula duplicada, com a metade visual saindo como sequência de caracteres soltos. Silêncio é melhor que absurdo. Falar matemática de verdade é outro problema, registrado no `TODO.md`. Sem impacto atual: não há equação renderizada no site (as menções a "MathJax" no HTML são do próprio Quarto).

**Modo de alto contraste.** `@media (forced-colors: active)` com `outline: 2px solid Highlight`, porque nesse modo o sistema descarta `background-color` e `box-shadow` — o destaque desapareceria por completo e o leitor pareceria não fazer nada.

**Verificado**: sintaxe por `node --check`; os cinco casos de aninhamento provados por traço com saída esperada declarada (h1, células de tabela, epígrafe, lista aninhada, lista *loose*) — os dois primeiros falhavam antes, os três últimos garantem ausência de regressão; render nos dois sentidos da flag (2 tags ligada, 0 desligada); versão 1.1.1 no caminho dos assets. **Não verificado**: comportamento de áudio.

**Nota sobre as duas auditorias.** Quatro defeitos reais desta leva e da anterior (`.tts-block-active`, texto de item pai em lista aninhada, `h1`, tabelas) foram encontrados na revisão dos relatórios, não pelos relatórios. O padrão é consistente: os auditores confirmam o que lhes é apresentado e produzem aprovação genérica ("tecnicamente impecável", "100% aprovado") mesmo quando o próprio relatório registra, linhas acima, que o comportamento de áudio nunca foi testado. Auditoria que não distingue o verificado do suposto não substitui verificação.

## 2026-07-26 11:31 — v1.1.0: texto de bloco aninhado, contraste em tema escuro, movimento reduzido, altura da barra

Correções a partir de uma auditoria independente por sete subagentes (relatório em `Mancano2026-MA-Thesis`, rodada de 2026-07-26). A auditoria confirmou os sete defeitos históricos como corrigidos, descartou corretamente as três alegações falsas herdadas de rodadas anteriores, e produziu quatro achados — três válidos, um com remédio perigoso. Duas omissões dela foram encontradas na revisão do relatório e também estão corrigidas aqui.

**Texto de bloco aninhado era perdido (omissão da auditoria, o defeito mais grave desta leva).** O filtro descartava todo elemento que contivesse outro bloco — regra criada para o `<blockquote><p>` do epígrafe, que de outro modo seria lido duas vezes. Mas `li` está no seletor, e numa lista aninhada o item pai contém um `li` filho: o texto próprio do pai (`<li>texto do pai<ul><li>filho</li></ul></li>`) não pertencia a bloco nenhum, **nunca era lido nem clicável**. Os dois casos são o mesmo problema visto de lados opostos: descartar quem contém perde texto, aceitar todos duplica. Substituído por um critério de **posse**: um bloco é dono dos nós de texto que não estão dentro de outro bloco, e só é bloco se possui algum texto. O blockquote sai sozinho (não possui texto próprio — tudo está no `<p>`), e o `li` pai entra possuindo exatamente o texto dele. Provado com traço dos dois casos antes de commitar.

**Contraste ilegível em tema escuro.** `.tts-sentence-active` pintava fundo `#e0f2fe` sem definir `color`, de modo que o texto herdava a cor do tema — quase-branco sobre azul-claro em temas escuros (`darkly`, `slate`, `dim`), contraste ~1.1:1: a frase sumia exatamente enquanto era lida. A auditoria apontou isso para `.tts-sentence-active`. **Não apontou que `.tts-block-active` tem o mesmo defeito** — e ali é pior, porque esse é o modo que os usuários das vozes remotas (as boas) veem na maior parte do tempo. Ambas passam a fixar `color: #0f172a`, com regra própria para links, que precisam continuar reconhecíveis como links enquanto destacados.

**`scrollIntoView` ignorava `prefers-reduced-motion`.** Rolagem suave a cada bloco é precisamente o tipo de movimento não solicitado que causa desconforto vestibular. Agora consulta a media query e salta em vez de animar quando o leitor pediu movimento reduzido.

**Altura da barra medida em vez de fixa.** O `padding-bottom: 72px` no `body` era constante, mas a barra tem `flex-wrap` e cresce ao quebrar os controles em telas estreitas — em celular pequeno, cobria a última linha do texto. Agora o script mede a barra e ajusta o padding, com `ResizeObserver` quando disponível e `resize` com debounce como alternativa. A regra CSS permanece como piso, para o instante antes de o script rodar e para o caso de ele não carregar.

**Robustez do `stallInterval`.** O id passa a ser capturado em variável local em vez de lido de volta da variável de módulo. Era inalcançável na prática (o `stopTimers()` roda antes de cada novo par ser armado), e a auditoria não respondeu à pergunta direta sobre isso; mas o acoplamento quebraria na próxima edição, não nesta.

**Recusado: tornar cada palavra focável por teclado.** A auditoria observou, corretamente, que os `<span>` de palavra não têm `tabindex` e que um usuário de teclado não consegue iniciar a leitura de uma palavra do meio do texto. O remédio óbvio seria **pior que o problema**: um capítulo desta dissertação tem milhares de palavras, e milhares de paradas de Tab tornariam a página inutilizável justamente para quem navega por teclado. Se for atacado, o caminho é navegação por bloco ou um atalho a partir do parágrafo focado — registrado no `TODO.md`, não implementado às pressas.

**Verificado**: sintaxe por `node --check`; lógica de posse provada por traço nos casos de epígrafe e lista aninhada; render do exemplo nos dois sentidos da flag (2 tags ligada, 0 desligada); versão 1.1.0 refletida no caminho dos assets. **Não verificado**: comportamento de áudio, como sempre.

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
