import {URL, fileURLToPath} from 'node:url'

import {ux} from './cli-ux'
import {Config} from './config'
import {getHelpFlagAdditions, loadHelpClass, normalizeArgv} from './help'
import * as Interfaces from './interfaces'
import {OCLIF_MARKER_OWNER, Performance} from './performance'

const debug = require('debug')('oclif:main')

export const helpAddition = (argv: string[], config: Interfaces.Config): boolean => {
  if (argv.length === 0 && !config.pjson.oclif.default) return true
  const mergedHelpFlags = getHelpFlagAdditions(config)
  for (const arg of argv) {
    if (mergedHelpFlags.includes(arg)) return true
    if (arg === '--') return false
  }

  return false
}

export const versionAddition = (argv: string[], config?: Interfaces.Config): boolean => {
  const additionalVersionFlags = config?.pjson.oclif.additionalVersionFlags ?? []
  const mergedVersionFlags = [...new Set(['--version', ...additionalVersionFlags]).values()]
  if (mergedVersionFlags.includes(argv[0])) return true
  return false
}

export async function run(argv?: string[], options?: Interfaces.LoadOptions): Promise<unknown> {
  const marker = Performance.mark(OCLIF_MARKER_OWNER, 'main.run')

  const initMarker = Performance.mark(OCLIF_MARKER_OWNER, 'main.run#init')

  const collectPerf = async () => {
    marker?.stop()
    if (!initMarker?.stopped) initMarker?.stop()
    await Performance.collect()
    Performance.debug()
  }

  const showHelp = async (argv: string[]) => {
    const Help = await loadHelpClass(config)
    const help = new Help(config, config.pjson.oclif.helpOptions ?? config.pjson.helpOptions)
    await help.showHelp(argv)
  }

  debug(`process.execPath: ${process.execPath}`)
  debug(`process.execArgv: ${process.execArgv}`)
  debug('process.argv: %O', process.argv)

  argv = argv ?? process.argv.slice(2)
  // Handle the case when a file URL string or URL is passed in such as 'import.meta.url'; covert to file path.
  if (options && ((typeof options === 'string' && options.startsWith('file://')) || options instanceof URL)) {
    options = fileURLToPath(options)
  }

  const config = await Config.load(options ?? require.main?.filename ?? __dirname)

  let [id, ...argvSlice] = normalizeArgv(config, argv)
  // run init hook
  await config.runHook('init', {argv: argvSlice, id})

  // display version if applicable
  if (versionAddition(argv, config)) {
    ux.log(config.userAgent)
    await collectPerf()
    return
  }

  // display help version if applicable
  if (helpAddition(argv, config)) {
    await showHelp(argv)
    await collectPerf()
    return
  }

  // find & run command
  const cmd = config.findCommand(id)
  if (!cmd) {
    const topic = config.flexibleTaxonomy ? null : config.findTopic(id)
    if (topic) {
      await showHelp([id])
      await collectPerf()
      return
    }

    if (config.pjson.oclif.default) {
      id = config.pjson.oclif.default
      argvSlice = argv
    }
  }

  initMarker?.stop()

  // If the the default command is '.' (signifying that the CLI is a single command CLI) and '.' is provided
  // as an argument, we need to add back the '.' to argv since it was stripped out earlier as part of the
  // command id.
  if (config.pjson.oclif.default === '.' && id === '.' && argv[0] === '.') argvSlice = ['.', ...argvSlice]

  try {
    return await config.runCommand(id, argvSlice, cmd)
  } finally {
    await collectPerf()
  }
}
