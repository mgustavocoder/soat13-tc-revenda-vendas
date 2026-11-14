class Logger {
  constructor(output = console) {
    this.output = output
  }

  info(message, context) {
    this.#write('info', message, context)
  }

  warn(message, context) {
    this.#write('warn', message, context)
  }

  error(message, context) {
    this.#write('error', message, context)
  }

  #write(level, message, context) {
    const args = context === undefined ? [message] : [message, context]
    this.output[level](...args)
  }
}

export { Logger }
