# soat13-tc-revenda-vendas

Serviço independente para reservas e vendas. Mantém apenas o banco de vendas; consulta clientes e solicita mudanças de disponibilidade do veículo usando as APIs HTTP dos outros serviços. Não compartilha código, banco, volume ou rede Docker com eles.

As colunas `cliente_id` e `veiculo_id` guardam somente os identificadores recebidos por API; não há chaves estrangeiras ou conexão com os bancos dos outros serviços.

## Executar

```bash
cp .env.example .env
docker compose up -d --build
```

O serviço fica disponível em `http://localhost:3003`; o MySQL deste projeto usa a porta `3309`. Para executar sem Docker, configure as URLs de clientes e veículos no `.env`, instale com `npm install` e inicie com `npm start`.

As credenciais `root/root` do `.env.example` são somente para desenvolvimento
local. Não reutilize em produção, não versione o arquivo `.env` e nunca coloque
credenciais AWS no projeto.

Ao usar Docker Compose localmente, as URLs padrão acessam os serviços publicados no host (`host.docker.internal`). Em outro ambiente, defina `CLIENTES_SERVICE_URL` e `VEICULOS_SERVICE_URL` para as URLs HTTP acessíveis pelo container.

## API

- `GET /api/health`
- `GET /api/vendas`
- `GET /api/vendas/:codigo` para consultar o processamento
- `POST /api/vendas/reservar` com `{ "veiculoPlaca": "ABC1D23", "clienteCpf": "12345678901" }` (responde `202 Accepted`)
- `POST /api/vendas/:codigo/cancelar`
- `POST /api/vendas/:codigo/confirmar-pagamento` (responde `202 Accepted`)

Reserva e confirmação de pagamento são processadas assincronamente por uma fila
SQS. Consulte o `status` pelo código da venda até chegar a `AGUARDANDO_PAGAMENTO`,
`PAGAMENTO_CONFIRMADO`, `CANCELADA` ou um estado de falha. O worker é iniciado
com `npm run worker`; configure `AWS_REGION` e `SQS_QUEUE_URL` junto das
variáveis de banco e URLs dos serviços dependentes. A fila standard pode
entregar uma mensagem mais de uma vez; o worker verifica o estado persistido da
venda e mensagens que excedem as tentativas são encaminhadas para a DLQ.

O endpoint de confirmação registra a confirmação do pagamento no fluxo de
venda; não há integração com um provedor financeiro nem armazenamento de dados
de cartão. A venda armazena CPF e placa para relacionar a operação.

## AWS

O deploy de produção usa a imagem deste serviço no ECR e o manifesto Kubernetes
mantido em `soat13-tc-revenda-infra-k8s`. As chamadas para clientes e veículos
usam Services internos do Kubernetes, não URLs públicas. Consulte o README da
infraestrutura para provisionamento e deploy. Não configure chaves AWS dentro
do projeto.

## Repositórios relacionados

- [Clientes](https://github.com/mgustavocoder/soat13-tc-revenda-clientes)
- [Veículos](https://github.com/mgustavocoder/soat13-tc-revenda-veiculos)
- [Infraestrutura de banco](https://github.com/mgustavocoder/soat13-tc-revenda-infra-db)
- [Infraestrutura EKS e API Gateway](https://github.com/mgustavocoder/soat13-tc-revenda-infra-k8s)
- [Arquitetura, segurança e Saga (PDF)](https://github.com/mgustavocoder/soat13-tc-revenda-infra-k8s/blob/main/docs/arquitetura-seguranca-saga.pdf)
