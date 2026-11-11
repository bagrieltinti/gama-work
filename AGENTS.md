# Gama Work

## Estrutura

- `src/App.tsx`: shell autenticado, páginas do espaço, modais e fluxos principais.
- `src/components/`: telas de acesso, marca e landing page.
- `src/worker/index.ts`: autenticação e registro das rotas Hono.
- `src/worker/routes/`: endpoints por recurso.
- `src/database/schema.ts` e `migrations/`: modelo e migrações do D1.
- `cloudflare.config.ts`: Worker, binding D1 e segredos.
- `public/gama-mark.png`: marca da Agência Gama extraída do brandbook fornecido.

## Regras do projeto

- Mantenha o produto em português do Brasil e as cores do brandbook da Agência Gama.
- Não inclua e-mails pessoais, tokens ou outros valores de segredo no código versionado.
- O Worker deve validar no servidor regras de segurança e permissões; validações visuais na interface são complementares.
- Convites e dados de cada empresa devem continuar isolados por espaço.
- A landing page vive em `/landing`; o aplicativo autenticado vive em `/` e em `/join/:token`.
- Para mudanças no deploy, preserve os bindings existentes do Cloudflare e não altere dados reais do D1.
