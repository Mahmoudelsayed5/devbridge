import * as vscode from "vscode";

import {
  describeResult,
  inferSource,
  noteworthy,
  runTransform,
  runValidate,
  sourceChoices,
  targetChoices,
} from "./core.js";

/**
 * Thin glue over `core.ts`.
 *
 * Everything here touches the `vscode` API, which only exists inside a
 * running editor, so this file holds no decisions worth testing — they live
 * in `core.ts`, which is covered.
 */

/** Text to transform: the selection when there is one, else the whole file. */
function textOf(editor: vscode.TextEditor): string {
  return editor.selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(editor.selection);
}

async function resolveSource(
  document: vscode.TextDocument,
): Promise<string | undefined> {
  const inferred = inferSource(document.languageId, document.fileName);

  if (inferred !== undefined) {
    return inferred;
  }

  const picked = await vscode.window.showQuickPick(
    sourceChoices().map((choice) => ({
      label: choice.label,
      detail: choice.detail,
      id: choice.id,
    })),
    { title: "DevBridge: what is this document?" },
  );

  return picked?.id;
}

async function openResult(
  content: string,
  language: string,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    content,
    language,
  });

  await vscode.window.showTextDocument(document, { preview: false });
}

async function transformCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (editor === undefined) {
    void vscode.window.showWarningMessage("DevBridge: open a file first.");

    return;
  }

  const source = await resolveSource(editor.document);

  if (source === undefined) {
    return;
  }

  const targets = targetChoices(source);

  if (targets.length === 0) {
    void vscode.window.showWarningMessage(
      `DevBridge: no targets are available for ${source}.`,
    );

    return;
  }

  const target = await vscode.window.showQuickPick(
    targets.map((choice) => ({ label: choice.label, id: choice.id })),
    { title: `DevBridge: transform ${source} into…` },
  );

  if (target === undefined) {
    return;
  }

  const outcome = runTransform(textOf(editor), source, target.id);

  if (!outcome.ok) {
    void vscode.window.showErrorMessage(`DevBridge: ${outcome.message}`);

    return;
  }

  // A target that emits one file per type gets a picker; anything else opens
  // straight away, because a single-item quick pick is just a speed bump.
  if (outcome.files.length > 1) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "All files", detail: "Open every generated file", path: "*" },
        ...outcome.files.map((file) => ({
          label: file.path,
          detail: `${file.content.split("\n").length} lines`,
          path: file.path,
        })),
      ],
      { title: `DevBridge: ${describeResult(outcome)}` },
    );

    if (picked === undefined) {
      return;
    }

    const chosen =
      picked.path === "*"
        ? outcome.files
        : outcome.files.filter((file) => file.path === picked.path);

    for (const file of chosen) {
      await openResult(file.content, outcome.language);
    }
  } else {
    await openResult(outcome.preview, outcome.language);
  }

  const problems = noteworthy(outcome.diagnostics);

  if (problems.length > 0) {
    void vscode.window.showWarningMessage(
      `DevBridge: ${problems[0]?.message ?? ""}`,
    );
  } else {
    void vscode.window.setStatusBarMessage(
      `DevBridge: ${describeResult(outcome)}`,
      4000,
    );
  }
}

async function validateCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (editor === undefined) {
    void vscode.window.showWarningMessage("DevBridge: open a file first.");

    return;
  }

  const source = await resolveSource(editor.document);

  if (source === undefined) {
    return;
  }

  const summary = runValidate(textOf(editor), source);

  if (summary.ok) {
    void vscode.window.showInformationMessage(`DevBridge: ${summary.message}`);
  } else {
    void vscode.window.showErrorMessage(`DevBridge: ${summary.message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("devbridge.transform", () => {
      void transformCommand();
    }),
    vscode.commands.registerCommand("devbridge.validate", () => {
      void validateCommand();
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up: the engine holds no resources and no process runs.
}
