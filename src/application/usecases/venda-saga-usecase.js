import { StatusVenda } from '../../domain/entities/venda.js'
import { CodigoVenda } from '../../domain/entities/value-objects/codigo-venda.js'
import { InvalidInputError } from '../../domain/errors/invalid-input-error.js'
import { EventosVenda } from '../gateways/venda-eventos-publisher.js'

class ConcurrentUpdateError extends Error {
  constructor() {
    super('A venda foi alterada por outra operação; o evento será reprocessado.')
    this.name = 'ConcurrentUpdateError'
  }
}

/**
 * Reações de vendas aos eventos publicados pelo serviço de veículos.
 *
 * Cada handler só age se a venda estiver no estado que espera aquele evento;
 * entregas duplicadas ou fora de ordem são ignoradas (idempotência). Se uma
 * reserva chegar para uma venda já encerrada, vendas publica VENDA_CANCELADA
 * para que veículos compense a reserva.
 */
class VendaSagaUsecase {
  constructor(vendaRepository, eventosPublisher, logger = console) {
    this.vendaRepository = vendaRepository
    this.eventosPublisher = eventosPublisher
    this.logger = logger
  }

  async onVeiculoReservado(evento) {
    const venda = await this.#carregar(evento)
    if (!venda) return
    if (venda.aguardaReserva()) {
      venda.confirmarReserva({ veiculoId: evento.veiculoId ?? null, preco: evento.preco ?? null })
      return this.#gravar(venda, StatusVenda.RESERVA_PROCESSANDO)
    }
    if (venda.dispensaReserva()) {
      this.logger.warn('Reserva recebida para venda encerrada; publicando compensação.', { vendaCodigo: venda.codigo })
      await this.eventosPublisher.publicar(EventosVenda.VENDA_CANCELADA, {
        vendaCodigo: venda.codigo,
        veiculoPlaca: venda.veiculoPlaca,
        motivo: 'Reserva recebida para uma venda já encerrada.'
      })
    }
  }

  async onVeiculoReservaFalhou(evento) {
    const venda = await this.#carregar(evento)
    if (!venda?.aguardaReserva()) return
    venda.falharReserva(evento.motivo || 'Não foi possível reservar o veículo.')
    return this.#gravar(venda, StatusVenda.RESERVA_PROCESSANDO)
  }

  async onVeiculoVendido(evento) {
    const venda = await this.#carregar(evento)
    if (!venda?.aguardaVendaDoVeiculo()) return
    venda.concluirPagamento()
    return this.#gravar(venda, StatusVenda.PAGAMENTO_PROCESSANDO)
  }

  async onVeiculoVendaFalhou(evento) {
    const venda = await this.#carregar(evento)
    if (!venda?.aguardaVendaDoVeiculo()) return
    venda.falharPagamento(evento.motivo || 'Não foi possível concluir a venda do veículo.')
    return this.#gravar(venda, StatusVenda.PAGAMENTO_PROCESSANDO)
  }

  async onVeiculoLiberado(evento) {
    this.logger.info('Reserva do veículo liberada pela compensação da saga.', { vendaCodigo: evento?.vendaCodigo })
  }

  async #carregar(evento) {
    if (!CodigoVenda.isValid(evento?.vendaCodigo)) {
      throw new InvalidInputError('Evento de veículo inválido.')
    }
    const venda = await this.vendaRepository.buscarPorCodigo(CodigoVenda.normalizar(evento.vendaCodigo))
    if (!venda) {
      this.logger.warn(`Evento ${evento.tipo} ignorado: venda não encontrada.`, { vendaCodigo: evento.vendaCodigo })
    }
    return venda
  }

  async #gravar(venda, statusAnterior) {
    const gravou = await this.vendaRepository.atualizar(venda, statusAnterior)
    if (!gravou) throw new ConcurrentUpdateError()
  }
}

export { ConcurrentUpdateError, VendaSagaUsecase }
