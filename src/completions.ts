import type { Completions } from "incur";

type Candidate = Completions.Candidate;

export const supportedShells = ["bash", "zsh", "fish", "nushell", "powershell", "elvish"] as const;

/**
 * Output of `tempo wallet completions [shell]` where incur's builtin falls short: it cannot
 * hook a two-word command name and has no PowerShell or Elvish output. Each hook registers
 * for the `tempo` launcher and only answers after `tempo wallet`. Bash and zsh call back into
 * incur's `COMPLETE=<shell>` handler; PowerShell and Elvish offer a static list of top-level
 * commands and global options. Returns undefined for shells left to incur (fish, nushell).
 */
export function completionScript(shell: string | undefined, candidates: () => Candidate[]) {
  if (shell === undefined) return `Supported shells: ${supportedShells.join(", ")}`;
  if (shell === "bash") return bash;
  if (shell === "zsh") return zsh;
  if (shell === "powershell") return powershell(candidates());
  if (shell === "elvish") return elvish(candidates());
  return undefined;
}

const bash = `_tempo_wallet() {
    [[ \${COMP_WORDS[1]} == wallet ]] || return 0
    local words=("\${COMP_WORDS[@]:1}")
    local IFS=$'\\013'
    COMPREPLY=($(COMPLETE=bash _COMPLETE_INDEX=$((COMP_CWORD - 1)) tempo wallet -- "\${words[@]}" 2>/dev/null))
    IFS=$' \\t\\n'
    COMPREPLY=("\${COMPREPLY[@]%$'\\001'}")
}
complete -o default -o bashdefault -F _tempo_wallet tempo`;

const zsh = `#compdef tempo
_tempo_wallet() {
    [[ \${words[2]} == wallet ]] || return 1
    local -a candidates
    candidates=("\${(@f)$(COMPLETE=zsh _COMPLETE_INDEX=$((CURRENT - 2)) tempo wallet -- "\${(@)words[2,-1]}" 2>/dev/null)}")
    [[ -n $candidates ]] && _describe 'values' candidates
}
compdef _tempo_wallet tempo`;

function powershell(candidates: Candidate[]) {
  const entries = candidates
    .map(({ value, description }) => `        ${quote(value)} = ${quote(description || value)}`)
    .join("\n");
  return `Register-ArgumentCompleter -Native -CommandName tempo -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    if ($commandAst.CommandElements.Count -lt 2 -or "$($commandAst.CommandElements[1])" -ne 'wallet') { return }
    $candidates = [ordered]@{
${entries}
    }
    foreach ($candidate in $candidates.GetEnumerator()) {
        if ($candidate.Key -like "$wordToComplete*") {
            [System.Management.Automation.CompletionResult]::new($candidate.Key, $candidate.Key, 'ParameterValue', $candidate.Value)
        }
    }
}`;
}

function elvish(candidates: Candidate[]) {
  const entries = candidates
    .map(
      ({ value, description }) =>
        `        edit:complex-candidate ${quote(value)} &display=${quote(description ? `${value}  ${description}` : value)}`,
    )
    .join("\n");
  return `set edit:completion:arg-completer[tempo] = {|@words|
    if (and (> (count $words) 2) (==s $words[1] wallet)) {
${entries}
    }
}`;
}

// PowerShell and Elvish both escape a single quote inside single quotes by doubling it.
function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
