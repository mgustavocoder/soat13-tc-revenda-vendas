import { StatusVenda, Venda } from '../../domain/entities/venda.js'
import { CodigoVenda } from '../../domain/entities/value-objects/codigo-venda.js'
import { BusinessRuleError } from '../../domain/errors/business-rule-error.js'
import { InvalidInputError } from '../../domain/errors/invalid-input-error.js'
import { ResourceNotFoundError } from '../../domain/errors/resource-not-found-error.js'
import { EventosVenda } from '../gateways/venda-eventos-publisher.js'

/**
 * Comandos do cliente sobre a venda. Cada comando executa a transação local de
 * vendas e publica um evento de domínio; as etapas seguintes da saga acontecem
 * no serviço de veículos, que reage ao evento (coreografia, sem orquestrador).
 */
class VendaUsecase {
  constructor(vendaRepository, clientesGateway, eventosPublisher, logger = console) {
    this.vendaRepository = vendaRepository
    this.clientesGateway = clientesGateway
    this.eventosPublisher = eventosPublisher
    this.logger = logger
  }

  async listar() {
    return this.vendaRepository.listar()
  }

  async buscarPorCodigo(codigo) {
    if (!CodigoVenda.isValid(codigo)) {
      throw new InvalidInputError('Código da venda inválido.')
    }
    const venda = await this.vendaRepository.buscarPorCodigo(CodigoVenda.normalizar(codigo))
    if (!venda) {
      throw new ResourceNotFoundError('Venda não encontrada.')
    }
    return venda
  }

  /** Inicia a saga publicando VENDA_CRIADA. */
  async reservar(solicitacao) {
    const { veiculoPlaca, clienteCpf } = Venda.validarSolicitacao(solicitacao)
    const cliente = await this.clientesGateway.buscarPorCpf(clienteCpf)
    if (!cliente) {
      throw new ResourceNotFoundError('Cliente não encontrado.')
    }

    const venda = Venda.iniciar({ veiculoPlaca, clienteCpf, clienteId: cliente.id })
    await this.vendaRepository.criar(venda)

    try {
      await this.eventosPublisher.publicar(EventosVenda.VENDA_CRIADA, {
        vendaCodigo: venda.codigo,
        veiculoPlaca: venda.veiculoPlaca,
        clienteId: venda.clienteId
      })
    } catch (error) {
      venda.falharReserva('Não foi possível iniciar a reserva.')
      await this.#gravarSemFalhar(venda, StatusVenda.RESERVA_PROCESSANDO)
      throw error
    }

    return (await this.vendaRepository.buscarPorCodigo(venda.codigo)) ?? venda
  }

  /** Publica PAGAMENTO_RECEBIDO para que veículos conclua a venda. */
  async confirmarPagamento(codigo) {
    return this.#executarComando(codigo, (venda) => venda.iniciarPagamento(), (venda) => ({
      tipo: EventosVenda.PAGAMENTO_RECEBIDO,
      payload: { vendaCodigo: venda.codigo, veiculoPlaca: venda.veiculoPlaca }
    }))
  }

  /** Publica VENDA_CANCELADA, que compensa a reserva no serviço de veículos. */
  async cancelar(codigo) {
    return this.#executarComando(codigo, (venda) => venda.cancelar(), (venda) => ({
      tipo: EventosVenda.VENDA_CANCELADA,
      payload: { vendaCodigo: venda.codigo, veiculoPlaca: venda.veiculoPlaca, motivo: 'Cancelada pelo cliente.' }
    }))
  }

  async #executarComando(codigo, comando, evento) {
    const venda = await this.buscarPorCodigo(codigo)
    const anterior = venda.snapshot()
    comando(venda)

    const gravou = await this.vendaRepository.atualizar(venda, anterior.status)
    if (!gravou) throw new BusinessRuleError('A venda foi alterada por outra operação.')

    const { tipo, payload } = evento(venda)
    try {
      await this.eventosPublisher.publicar(tipo, payload)
    } catch (error) {
      const statusAtual = venda.status
      venda.restaurar(anterior)
      await this.#gravarSemFalhar(venda, statusAtual)
      throw error
    }
    return venda
  }

  async #gravarSemFalhar(venda, statusAnterior) {
    try {
      await this.vendaRepository.atualizar(venda, statusAnterior)
    } catch (error) {
      this.logger.error('Falha ao registrar o estado da venda após erro ao publicar evento.', {
        vendaCodigo: venda.codigo,
        error: error.message
      })
    }
  }
}

export { VendaUsecase }
