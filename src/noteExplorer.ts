import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import * as vscode from 'vscode'

import { Octokit } from '@octokit/rest'
import * as utils from './lib/utils'

export class FileStat implements vscode.FileStat {
  constructor(private fsStat: fs.Stats) {}

  get type(): vscode.FileType {
    return this.fsStat.isFile()
      ? vscode.FileType.File
      : this.fsStat.isDirectory()
        ? vscode.FileType.Directory
        : this.fsStat.isSymbolicLink()
          ? vscode.FileType.SymbolicLink
          : vscode.FileType.Unknown
  }

  get isFile(): boolean | undefined {
    return this.fsStat.isFile()
  }

  get isDirectory(): boolean | undefined {
    return this.fsStat.isDirectory()
  }

  get isSymbolicLink(): boolean | undefined {
    return this.fsStat.isSymbolicLink()
  }

  get size(): number {
    return this.fsStat.size
  }

  get ctime(): number {
    return this.fsStat.ctime.getTime()
  }

  get mtime(): number {
    return this.fsStat.mtime.getTime()
  }
}

interface Entry {
  uri: vscode.Uri
  type: vscode.FileType
}

export class NoteProvider
implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {
  private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>
  private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined | void>
    = new vscode.EventEmitter<Entry | undefined | void>()

  readonly onDidChangeTreeData: vscode.Event<Entry | undefined | void>
    = this._onDidChangeTreeData.event

  constructor() {
    this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
    return this._onDidChangeFile.event
  }

  watch(
    uri: vscode.Uri,
    options: { recursive: boolean, excludes: string[] },
  ): vscode.Disposable {
    const watcher = fs.watch(
      uri.fsPath,
      { recursive: options.recursive },
      async (event, filename) => {
        if (filename) {
          const filepath = path.join(
            uri.fsPath,
            utils.normalizeNFC(filename.toString()),
          )

          // TODO support excludes (using minimatch library?)

          this._onDidChangeFile.fire([
            {
              type:
                event === 'change'
                  ? vscode.FileChangeType.Changed
                  : (await utils.exists(filepath))
                      ? vscode.FileChangeType.Created
                      : vscode.FileChangeType.Deleted,
              uri: uri.with({ path: filepath }),
            } as vscode.FileChangeEvent,
          ])
        }
      },
    )

    return { dispose: () => watcher.close() }
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    return this._stat(uri.fsPath)
  }

  async _stat(path: string): Promise<vscode.FileStat> {
    return new FileStat(await utils.stat(path))
  }

  readDirectory(
    uri: vscode.Uri,
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    return this._readDirectory(uri)
  }

  async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const children = await utils.readdir(uri.fsPath)

    const result: [string, vscode.FileType][] = []
    for (let i = 0; i < children.length; i++) {
      if (children[i] === '.git')
        continue

      const child = children[i]
      const stat = await this._stat(path.join(uri.fsPath, child))
      result.push([child, stat.type])
    }

    return Promise.resolve(result)
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    return utils.mkdir(uri.fsPath)
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    return utils.readfile(uri.fsPath)
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean, overwrite: boolean },
  ): void | Thenable<void> {
    return this._writeFile(uri, content, options)
  }

  async _writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean, overwrite: boolean },
  ): Promise<void> {
    const exists = await utils.exists(uri.fsPath)
    if (!exists) {
      if (!options.create)
        throw vscode.FileSystemError.FileNotFound()

      await utils.mkdir(path.dirname(uri.fsPath))
    }
    else {
      if (!options.overwrite)
        throw vscode.FileSystemError.FileExists()
    }

    return utils.writefile(uri.fsPath, content as Buffer)
  }

  delete(
    uri: vscode.Uri,
    options: { recursive: boolean },
  ): void | Thenable<void> {
    if (options.recursive)
      return utils.rmrf(uri.fsPath)

    return utils.unlink(uri.fsPath)
  }

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): void | Thenable<void> {
    return this._rename(oldUri, newUri, options)
  }

  async _rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    const exists = await utils.exists(newUri.fsPath)
    if (exists) {
      if (!options.overwrite)
        throw vscode.FileSystemError.FileExists()
      else
        await utils.rmrf(newUri.fsPath)
    }

    const parentExists = await utils.exists(path.dirname(newUri.fsPath))
    if (!parentExists)
      await utils.mkdir(path.dirname(newUri.fsPath))

    return utils.rename(oldUri.fsPath, newUri.fsPath)
  }

  // tree data provider

  async getChildren(element?: Entry): Promise<Entry[]> {
    if (element) {
      const children = await this.readDirectory(element.uri)
      return children.map(([name, type]) => ({
        uri: vscode.Uri.file(path.join(element.uri.fsPath, name)),
        type,
      }))
    }

    const rootUri = vscode.Uri.file(`${os.homedir()}/.dory-notes`)

    const children = await this.readDirectory(rootUri)

    children.sort((a, b) => {
      if (a[1] === b[1])
        return a[0].localeCompare(b[0])

      return a[1] === vscode.FileType.Directory ? -1 : 1
    })

    return children.map(([name, type]) => ({
      uri: vscode.Uri.file(path.join(rootUri.fsPath, name)),
      type,
    }))
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.uri,
      element.type === vscode.FileType.Directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    if (element.type === vscode.FileType.File) {
      treeItem.command = {
        command: 'dory-notes.openNote',
        title: 'Open Note',
        arguments: [element.uri],
      }
      treeItem.contextValue = 'file'
    }
    return treeItem
  }
}

export class NoteExplorer {
  context: vscode.ExtensionContext
  octokit: Octokit

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.octokit = new Octokit()
    const treeDataProvider = new NoteProvider()

    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        'dory-notes-container',
        treeDataProvider,
      ),
    )

    vscode.commands.registerCommand('dory-notes.openNote', resource =>
      this.openNote(resource))

    vscode.commands.registerCommand(
      'dory-notes.newNote',
      async () => await this.newNote(),
    )

    vscode.commands.registerCommand('dory-notes.refresh', () =>
      treeDataProvider.refresh())

    vscode.workspace.onDidSaveTextDocument(async (document) => {
      // await this.addAndCommit(document);
      console.log('saved')
    })
  }

  private openNote(resource: vscode.Uri): void {
    vscode.window.showTextDocument(resource)
  }

  private async newNote(): Promise<void> {
    const value = await vscode.window.showInputBox({
      prompt: 'Enter a filename',
    })

    if (value === undefined)
      return

    const filename = value.trim()
    if (filename.length === 0)
      return

    const rootPath = await this.context.secrets.get('dory-notes.rootPath')
    const rootUri = vscode.Uri.file(rootPath!)
    const filePath = vscode.Uri.joinPath(rootUri, filename)

    await utils.writefile(filePath.fsPath, Buffer.from(''))
    vscode.window.showTextDocument(filePath)

    vscode.commands.executeCommand('dory-notes.refresh')
  }

  // private async addAndCommit(document: vscode.TextDocument): Promise<void> {
  //   const userInfo = await this.octokit.users.getAuthenticated();
  //   const rootPath = await this.context.secrets.get("dory-notes.rootPath");
  //   const rootUri = vscode.Uri.file(rootPath!);

  //   await exec(`git add ${document.uri.fsPath}`, { cwd: rootUri.fsPath });
  //   await exec(`git commit -m "Update notes: ${document.fileName}"`, {
  //     cwd: rootUri.fsPath,
  //   });

  //   this.octokit.rest.git.createCommit({
  //     owner: userInfo.data.login,
  //     repo: "personal-dory-notes",
  //     message: "Update notes",
  //     tree: "tree",
  //     parents: ["parent"],
  //   });
  // }
}
