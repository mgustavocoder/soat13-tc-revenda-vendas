/**
 * Eventos publicados pelo serviço de veículos na fila `veiculos-eventos` aos
 * quais vendas reage.
 */
const EventosVeiculo = Object.freeze({
  VEICULO_RESERVADO: 'VEICULO_RESERVADO',
  VEICULO_RESERVA_FALHOU: 'VEICULO_RESERVA_FALHOU',
  VEICULO_VENDIDO: 'VEICULO_VENDIDO',
  VEICULO_VENDA_FALHOU: 'VEICULO_VENDA_FALHOU',
  VEICULO_LIBERADO: 'VEICULO_LIBERADO'
})

export { EventosVeiculo }
