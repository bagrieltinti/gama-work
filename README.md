# Gama Work

Primeiro protótipo de uma plataforma gratuita e aberta para organizar clientes, atendimentos, agendas e tarefas por empresa. Qualquer pessoa pode criar uma conta, abrir um ou mais espaços e convidar sua equipe. Cada espaço pode ter nome, descrição, ícone e cor personalizados.

## Recursos desta primeira versão

- Landing page principal em `/`; o sistema fica em `/acesso`. A navegação do app usa `/acesso` (visão geral), `/acesso/convites`, `/acesso/clientes`, `/acesso/agenda`, `/acesso/tarefas`, `/acesso/modelos` e `/acesso/equipe`. Convites por código usam `/acesso/join/:codigo`.
- Conta com e-mail e senha, exigindo nome completo, com entrada por Google preparada para receber as credenciais OAuth da Agência Gama.
- Cadastro com confirmação de senha, exibição e indicador de força; exige 12 caracteres, letras maiúsculas e minúsculas, número e símbolo.
- Cadastro aberto na fase de testes; cada conta pode ser proprietária de até três espaços. A API aplica o limite.
- Três vagas de convidado incluídas por espaço. Durante a beta, vagas adicionais seguem gratuitas e a interface apresenta apenas os valores previstos para o futuro; não há cobrança nem integração de pagamentos.
- Convites recebidos ficam na caixa de entrada para aceite ou recusa explícitos. Links têm código único, expiram em sete dias e podem ser regenerados pela proprietária.
- Proprietárias e administradoras gerenciam membros, papéis e cancelamento de convites. Administradoras convidam contas existentes; só a proprietária gera links e transfere a propriedade.
- Convite inicial para os e-mails de administração definidos no segredo `INITIAL_ADMIN_EMAILS` do Worker.
- Cadastro de clientes, status, fidelização, retorno e histórico de atendimentos.
- Agenda da equipe e itens pessoais, além de lista de tarefas.
- Modelos editáveis de jornadas, aplicáveis aos clientes.
- Importação de clientes por CSV ou exportação do Notion em ZIP, com seleção e mapeamento de colunas.
- Exportação em JSON (dados do espaço) e CSV (lista de clientes).

## Stack

- React, TypeScript e Vite
- Cloudflare Workers com Static Assets
- Cloudflare D1 para autenticação e dados
- Hono, Better Auth e Drizzle ORM

## Rodar localmente

Instale as dependências e inicie o Vite com o plugin Cloudflare:

```bash
npm install
npm run dev
```

O login e as rotas de dados locais precisam de uma instância D1 e dos segredos `BETTER_AUTH_SECRET`, `INITIAL_ADMIN_EMAILS`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. `INITIAL_ADMIN_EMAILS` aceita uma lista separada por vírgulas, ponto e vírgula ou quebras de linha. O e-mail inicial da proprietária está definido como `empresa@agenciagama.com.br`; os convites usam `https://work.agenciagama.com.br` como origem pública. Veja `cloudflare.config.ts` e `migrations/0001_initial.sql`.

## Deploy

O projeto usa a CLI `cf` do Cloudflare. O deploy mantém os bindings do Worker configurados na conta da Agência Gama:

```bash
npm run build
npm run deploy
```

Antes do primeiro deploy, configure a base D1 e os segredos no ambiente da conta Cloudflare da Agência Gama. Não coloque credenciais em arquivos versionados. O Worker usa o domínio `work.agenciagama.com.br`; a landing fica na raiz e a plataforma em `/acesso`.

## Identidade visual

As cores seguem o brandbook da Agência Gama: laranja `#F65A1E`, laranja escuro `#C94412`, grafite `#5F5B55`, branco `#F5F3EE` e preto `#131313`. A marca oficial é usada a partir de `public/gama-mark.png`. O protótipo usa Syne para títulos e Barlow Condensed para interface e conteúdo. A fonte Khavix indicada no brandbook não veio incluída nos arquivos, então não é usada nesta versão.

## Escopo do protótipo

O Gama Work está em fase de testes gratuita. Não há assinatura nem cobrança ativa. Valores informativos previstos para o futuro: R$ 29,90/mês pelo espaço principal, R$ 9,90/mês por espaço adicional e R$ 9,90/mês por convidado além dos três incluídos. O produto poderá se tornar pago futuramente, inclusive sem aviso prévio. Integração com WhatsApp, colaboração em documentos no estilo Notion e importação completa de todas as bases do Notion ficam para atualizações futuras.
