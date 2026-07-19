import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const pluginUrl = new URL('../desktop/plugin.js', import.meta.url)
let source = await fs.readFile(pluginUrl, 'utf8')

source = source.replace(
  "import { COMPOSER_AREAS, host } from '@hermes/plugin-sdk'",
  "const COMPOSER_AREAS = { liveVoice: 'composer.liveVoice' }; const host = globalThis.__voiceTestHost"
)

const sent = []
const states = []
const errors = []
const toolCalls = []
const transcripts = []

class FakeDataChannel {
  readyState = 'open'
  onclose = null
  onerror = null
  onmessage = null

  close() {
    this.readyState = 'closed'
  }

  send(value) {
    sent.push(JSON.parse(value))
  }
}

const dataChannel = new FakeDataChannel()

class FakePeerConnection {
  connectionState = 'connected'
  onconnectionstatechange = null
  ontrack = null

  addTrack() {}
  close() {
    this.connectionState = 'closed'
  }
  createDataChannel() {
    return dataChannel
  }
  async createOffer() {
    return { sdp: 'offer', type: 'offer' }
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
}

const stream = {
  getAudioTracks: () => [{ enabled: true }],
  getTracks: () => [{ stop() {} }]
}

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => stream } }
})
globalThis.RTCPeerConnection = FakePeerConnection
globalThis.Audio = class {
  autoplay = false
  srcObject = null
  pause() {}
  async play() {}
}
globalThis.AudioContext = class {
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData() {} }
  }
  createMediaStreamSource() {
    return { connect() {} }
  }
  async close() {}
}
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
globalThis.fetch = async () => ({ ok: true, text: async () => 'answer' })
globalThis.__voiceTestHost = {
  notifyError() {},
  async request(method, params) {
    if (method === 'live.session.describe') {
      return { instructions: 'Hermes', tools: [{ type: 'function', name: 'session_search' }] }
    }
    if (method === 'live.tool.execute') {
      toolCalls.push(params)
      return { output: 'Most recent: Realtime voice end-to-end validation' }
    }
    if (method === 'live.transcript.append') {
      transcripts.push(params)
      return { appended: true }
    }
    throw new Error(`unexpected RPC: ${method}`)
  }
}

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const plugin = (await import(moduleUrl)).default
let contribution

plugin.register({
  register(value) {
    contribution = value
  },
  rest: async () => ({ calls_url: 'https://api.openai.test/realtime/calls', value: 'ephemeral' })
})

assert.equal(contribution.area, 'composer.liveVoice')

const session = contribution.data.create({
  onError: error => errors.push(error),
  onState: state => states.push(state),
  onTranscript: (role, text) => transcripts.push({ role, text }),
  sessionId: 'desktop-session'
})

await session.start()
assert.equal(states.at(-1).status, 'listening')

const emit = event => dataChannel.onmessage({ data: JSON.stringify(event) })
emit({ type: 'response.created' })
emit({
  type: 'response.done',
  response: {
    output: [
      {
        arguments: '{"query":"voice"}',
        call_id: 'call-1',
        name: 'session_search',
        type: 'function_call'
      }
    ],
    status: 'completed'
  }
})
await new Promise(resolve => setTimeout(resolve, 0))

assert.deepEqual(toolCalls, [
  {
    arguments: { query: 'voice' },
    call_id: 'call-1',
    name: 'session_search',
    session_id: 'desktop-session'
  }
])
assert.equal(sent.at(-2).type, 'conversation.item.create')
assert.equal(sent.at(-2).item.type, 'function_call_output')
assert.equal(sent.at(-1).type, 'response.create')

emit({ type: 'response.created' })
emit({ type: 'output_audio_buffer.started' })
emit({ type: 'input_audio_buffer.speech_started' })
emit({ type: 'output_audio_buffer.cleared' })
emit({ type: 'input_audio_buffer.speech_stopped' })
emit({ type: 'response.created' })
emit({ type: 'response.done', response: { output: [], status: 'completed' } })

assert.equal(errors.length, 0)
assert.equal(states.at(-1).status, 'listening')

await session.end()
assert.equal(states.at(-1).status, 'idle')

console.log('desktop Realtime protocol test passed')
