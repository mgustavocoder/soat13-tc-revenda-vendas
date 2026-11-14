const PLACA_PATTERN = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/

class Placa {
  constructor(valor) {
    this.valor = valor
  }

  static normalizar(placa) {
    return String(placa ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
  }

  static isValid(placa) {
    return PLACA_PATTERN.test(Placa.normalizar(placa))
  }

  static criar(placa) {
    return new Placa(Placa.normalizar(placa))
  }

  getValor() {
    return this.valor
  }
}

export { Placa }
