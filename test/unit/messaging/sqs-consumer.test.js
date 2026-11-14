import assert from 'node:assert/strict'
import test from 'node:test'
import { DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { SqsConsumer } from '../../../src/infrastructure/messaging/sqs-consumer.js'

const silentLogger = { info() {}, warn() {}, error() {} }

const makeConsumer = (options) => {
  const deleted = []
  const sqsClient = {
    async send(command) {
      if (command instanceof DeleteMessageCommand) deleted.push(command.input.ReceiptHandle)
      return {}
    }
  }
  const consumer = new SqsConsumer({ sqsClient, queueUrl: 'q', logger: silentLogger, ...options })
  return { consumer, deleted }
}

const message = (body, receiveCount = 1) => ({
  MessageId: 'm1',
  ReceiptHandle: 'r1',
  Body: typeof body === 'string' ? body : JSON.stringify(body),
  Attributes: { ApproximateReceiveCount: String(receiveCount) }
})

test('successful, unknown and malformed messages are deleted', async () => {
  const handled = []
  const { consumer, deleted } = makeConsumer({ handlers: { A: async (e) => handled.push(e.tipo) } })
  await consumer.handleMessage(message({ tipo: 'A' }))
  await consumer.handleMessage(message({ tipo: 'B' }))
  await consumer.handleMessage(message('{not json'))
  assert.deepEqual(handled, ['A'])
  assert.equal(deleted.length, 3)
})

test('transient failures stay in the queue and trigger compensation on the last attempt', async () => {
  const compensated = []
  const { consumer, deleted } = makeConsumer({
    handlers: { A: async () => { throw new Error('db down') } },
    onExhausted: { A: async (e) => compensated.push(e.tipo) },
    maxReceiveCount: 3
  })
  await consumer.handleMessage(message({ tipo: 'A' }, 1))
  assert.deepEqual(compensated, [])
  await consumer.handleMessage(message({ tipo: 'A' }, 3))
  assert.deepEqual(compensated, ['A'])
  assert.equal(deleted.length, 0)
})

test('permanent failures are deleted without retry', async () => {
  class Permanent extends Error {}
  const { consumer, deleted } = makeConsumer({
    handlers: { A: async () => { throw new Permanent('bad') } },
    isPermanentError: (error) => error instanceof Permanent
  })
  await consumer.handleMessage(message({ tipo: 'A' }))
  assert.equal(deleted.length, 1)
})
