import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import * as vscode from 'vscode'

import { Auth } from './auth'
import { exec } from './lib/exec'
import { NoteExplorer } from './noteExplorer'

export async function activate(context: vscode.ExtensionContext) {
  const rootPath = path.join(os.homedir(), '.dory-notes')
  context.secrets.store('dory-notes.rootPath', rootPath)

  const authService = new Auth()
  await authService.initialize(context)

  new NoteExplorer(context)

  const disposable = vscode.commands.registerCommand(
    'dory-notes.login',
    async () => {
      try {
        const octokit = await authService.getOctokit()
        const userInfo = await octokit.users.getAuthenticated()

        const isCloned = fs.existsSync(rootPath)

        if (isCloned) {
          vscode.window.showInformationMessage(
            `Welcome back ${userInfo.data.name} to dory notes`,
          )

          return
        }

        const repo = await octokit.repos.createForAuthenticatedUser({
          name: 'personal-dory-notes',
          description: 'A minimalist and versioned notes application for programmers, inspired by Dory from Finding Nemo',
          private: true,
          auto_init: true,
        })

        await exec(`git clone ${repo.data.clone_url} ${rootPath}`)

        vscode.window.showInformationMessage(
          `Welcome ${userInfo.data.name} to dory notes`,
        )
      }
      catch (error) {
        vscode.window.showErrorMessage(
          `Error while trying to login into dory notes: ${error}`,
        )
      }
    },
  )

  context.subscriptions.push(disposable)
}

export function deactivate() {}
