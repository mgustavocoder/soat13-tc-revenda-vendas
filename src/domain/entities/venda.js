import { BusinessRuleError } from '../errors/business-rule-error.js'
import { InvalidInputError } from '../errors/invalid-input-error.js'
import { CodigoVenda } from './value-objects/codigo-venda.js'
import { Cpf } from './value-objects/cpf.js'
import { Placa } from './value-objects/placa.js'

/**
 * Estados da venda ao longo da saga coreografada:
 *
 *   RESERVA_PROCESSANDO ──VEICULO_RESERVADO──▶ AGUARDANDO_PAGAMENTO
 *          │                                    │            │
 *   VEICULO_RESERVA_FALHOU            confirmar pagamento   cancelar
 *          ▼                                    ▼            ▼
 *    RESERVA_FALHOU                 PAGAMENTO_PROCESSANDO  CANCELADA ──▶ VENDA_CANCELADA
 *                                     │               │                (compensação)
 *                              VEICULO_VENDIDO  VEICULO_VENDA_FALHOU
 *                                     ▼               ▼
 *                         PAGAMENTO_CONFIRMADO  PAGAMENTO_FALHOU (permite nova tentativa ou cancelamento)
 */
const StatusVenda = Object.freeze({
  RESERVA_PROCESSANDO: 'RESERVA_PROCESSANDO',
  RESERVA_FALHOU: 'RESERVA_FALHOU',
  AGUARDANDO_PAGAMENTO: 'AGUARDANDO_PAGAMENTO',
  PAGAMENTO_PROCESSANDO: 'PAGAMENTO_PROCESSANDO',
  PAGAMENTO_FALHOU: 'PAGAMENTO_FALHOU',
  CANCELADA: 'CANCELADA',
  PAGAMENTO_CONFIRMADO: 'PAGAMENTO_CONFIRMADO'
})

const AGUARDANDO_ACAO_DO_CLIENTE = [StatusVenda.AGUARDANDO_PAGAMENTO, StatusVenda.PAGAMENTO_FALHOU]
const TAMANHO_MAXIMO_ERRO = 500

class Venda {
  static StatusVenda = StatusVenda

  constructor({
    id = null,
    codigo,
    veiculoId = null,
    veiculoPlaca,
    clienteId = null,
    clienteCpf,
    dataVenda = null,
    preco = null,
    status,
    ultimoErro = null
  }) {
    this.id = id
    this.codigo = codigo
    this.veiculoId = veiculoId
    this.veiculoPlaca = veiculoPlaca
    this.clienteId = clienteId
    this.clienteCpf = clienteCpf
    this.dataVenda = dataVenda
    this.preco = preco
    this.status = status
    this.ultimoErro = ultimoErro
  }

  static validarSolicitacao({ veiculoPlaca, clienteCpf }) {
    if (!Placa.isValid(veiculoPlaca) || !Cpf.isValid(clienteCpf)) {
      throw new InvalidInputError('Informe uma placa e um CPF válidos.')
    }
    return {
      veiculoPlaca: Placa.normalizar(veiculoPlaca),
      clienteCpf: Cpf.normalizar(clienteCpf)
    }
  }

  /** Inicia a saga: a venda nasce aguardando a reserva do veículo. */
  static iniciar({ veiculoPlaca, clienteCpf, clienteId }) {
    const dados = Venda.validarSolicitacao({ veiculoPlaca, clienteCpf })
    return new Venda({
      ...dados,
      codigo: CodigoVenda.gerar(),
      clienteId,
      status: StatusVenda.RESERVA_PROCESSANDO
    })
  }

  // ---- Reações aos eventos de veículos ----------------------------------

  aguardaReserva() {
    return this.status === StatusVenda.RESERVA_PROCESSANDO
  }

  aguardaVendaDoVeiculo() {
    return this.status === StatusVenda.PAGAMENTO_PROCESSANDO
  }

  /** A venda já foi encerrada sem que a reserva do veículo seja válida. */
  dispensaReserva() {
    return [StatusVenda.RESERVA_FALHOU, StatusVenda.CANCELADA].includes(this.status)
  }

  confirmarReserva({ veiculoId, preco }) {
    this.#exigir([StatusVenda.RESERVA_PROCESSANDO], 'A venda não está aguardando reserva.')
    this.veiculoId = veiculoId
    this.preco = preco
    this.#mudarPara(StatusVenda.AGUARDANDO_PAGAMENTO)
  }

  falharReserva(motivo) {
    this.#exigir([StatusVenda.RESERVA_PROCESSANDO], 'A venda não está aguardando reserva.')
    this.#mudarPara(StatusVenda.RESERVA_FALHOU, motivo)
  }

  concluirPagamento() {
    this.#exigir([StatusVenda.PAGAMENTO_PROCESSANDO], 'A venda não está processando pagamento.')
    this.#mudarPara(StatusVenda.PAGAMENTO_CONFIRMADO)
  }

  falharPagamento(motivo) {
    this.#exigir([StatusVenda.PAGAMENTO_PROCESSANDO], 'A venda não está processando pagamento.')
    this.#mudarPara(StatusVenda.PAGAMENTO_FALHOU, motivo)
  }

  // ---- Comandos do cliente ----------------------------------------------

  iniciarPagamento() {
    if (this.status === StatusVenda.CANCELADA) {
      throw new BusinessRuleError('Não é possível confirmar pagamento de uma venda cancelada.')
    }
    if (this.status === StatusVenda.PAGAMENTO_CONFIRMADO) {
      throw new BusinessRuleError('Pagamento já confirmado para esta venda.')
    }
    if (this.status === StatusVenda.PAGAMENTO_PROCESSANDO) {
      throw new BusinessRuleError('A confirmação do pagamento já está em processamento.')
    }
    this.#exigir(AGUARDANDO_ACAO_DO_CLIENTE, 'A reserva ainda não está pronta para confirmação do pagamento.')
    this.#mudarPara(StatusVenda.PAGAMENTO_PROCESSANDO)
  }

  cancelar() {
    if (this.status === StatusVenda.CANCELADA) {
      throw new BusinessRuleError('Venda já cancelada.')
    }
    if (this.status === StatusVenda.PAGAMENTO_CONFIRMADO) {
      throw new BusinessRuleError('Não é possível cancelar uma venda já confirmada.')
    }
    this.#exigir(AGUARDANDO_ACAO_DO_CLIENTE, 'A venda não pode ser cancelada enquanto está sendo processada.')
    this.#mudarPara(StatusVenda.CANCELADA)
  }

  /**
   * Desfaz localmente um comando cujo evento não pôde ser publicado, para que
   * o estado persistido continue coerente com o que os outros serviços sabem.
   */
  restaurar({ status, ultimoErro }) {
    this.status = status
    this.ultimoErro = ultimoErro
  }

  snapshot() {
    return { status: this.status, ultimoErro: this.ultimoErro }
  }

  toPublic() {
    return {
      codigo: this.codigo,
      veiculoPlaca: this.veiculoPlaca,
      clienteCpf: this.clienteCpf,
      preco: this.preco == null ? null : Number(this.preco),
      dataVenda: this.dataVenda,
      status: this.status,
      ...(this.ultimoErro ? { erro: this.ultimoErro } : {})
    }
  }

  #exigir(statusPermitidos, mensagem) {
    if (!statusPermitidos.includes(this.status)) throw new BusinessRuleError(mensagem)
  }

  #mudarPara(status, motivo = null) {
    this.status = status
    this.ultimoErro = motivo == null ? null : String(motivo).slice(0, TAMANHO_MAXIMO_ERRO)
  }
}

export { StatusVenda, Venda }
