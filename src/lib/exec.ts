import util from 'node:util'
import childProcess from 'node:child_process'

export const exec = util.promisify(childProcess.exec)
