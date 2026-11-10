# soat13-tc-revenda-vendas

Serviço independente para reservas e vendas. Mantém apenas o banco de vendas; consulta clientes e solicita mudanças de disponibilidade do veículo usando as APIs HTTP dos outros serviços. Não compartilha código, banco, volume ou rede Docker com eles.

As colunas `cliente_id` e `veiculo_id` guardam somente os identificadores recebidos por API; não há chaves estrangeiras ou conexão com os bancos dos outros serviços.

## Executar

```bash
cp .env.example .env
docker compose up -d --build
```

O serviço fica disponível em `http://localhost:3003`; o MySQL deste projeto usa a porta `3309`. Para executar sem Docker, configure as URLs de clientes e veículos no `.env`, instale com `npm install` e inicie com `npm start`.

Ao usar Docker Compose localmente, as URLs padrão acessam os serviços publicados no host (`host.docker.internal`). Em outro ambiente, defina `CLIENTES_SERVICE_URL` e `VEICULOS_SERVICE_URL` para as URLs HTTP acessíveis pelo container.

## API

- `GET /api/health`
- `GET /api/vendas`
- `POST /api/vendas/reservar` com `{ "veiculoPlaca": "ABC1D23", "clienteCpf": "12345678901" }`
- `POST /api/vendas/:codigo/cancelar`
- `POST /api/vendas/:codigo/confirmar-pagamento`

## AWS

O deploy de produção usa a imagem deste serviço no ECR e o manifesto Kubernetes
mantido em `soat13-tc-revenda-infra-k8s`. As chamadas para clientes e veículos
usam Services internos do Kubernetes, não URLs públicas. Consulte o README da
infraestrutura para provisionamento e deploy. Não configure chaves AWS dentro
do projeto.
