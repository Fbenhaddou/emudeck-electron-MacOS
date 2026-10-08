import { useState } from 'react';
import type { LibraryCheck, LibraryIssue } from '../../../shared/macos';
import { Spinner } from '../controls';
import type { Operate } from './types';

function base(file: string): string {
  return file.split('/').pop() || file;
}

/** What is wrong, and what to do, in plain words. */
export function describeIssue(issue: LibraryIssue): string {
  switch (issue.kind) {
    case 'wrong-system':
      return `A ${issue.targetName} game in the wrong folder, so it won’t appear with your ${issue.targetName} games.`;
    case 'outside-system':
      return issue.targetName
        ? `Outside every system folder, so no emulator will find it. It looks like a ${issue.targetName} game.`
        : 'Outside every system folder, so no emulator will find it. Move it into the right system’s folder.';
    case 'unsupported':
      return 'Not a format this system’s emulator can open.';
    case 'empty':
      return 'An empty file (0 bytes), probably from a copy that didn’t finish.';
    case 'duplicate':
      return `Looks identical to “${base(issue.other || '')}”. Remove one if you don’t need both.`;
    case 'link':
      return 'A link to a file somewhere else. Links are skipped to keep your library safe; put the file itself here instead.';
    case 'apple-double':
      return 'Hidden macOS information left by copying to an external drive. Safe to ignore.';
    case 'incomplete-folder':
      return 'A game folder missing files it needs, perhaps from a copy that didn’t finish.';
    case 'multi-disc':
      return 'Discs of one game without an .m3u playlist, so each disc appears as its own game.';
    default:
      return '';
  }
}

export default function LibraryCheckSection({
  disabled,
  operate,
}: {
  disabled: boolean;
  operate: Operate;
}) {
  const [check, setCheck] = useState<LibraryCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const run = async () => {
    setChecking(true);
    try {
      setCheck(await window.mac.checkLibrary());
    } catch {
      setCheck(null);
    } finally {
      setChecking(false);
    }
  };
  const count = check?.issues.length ?? 0;
  let summary =
    'Looks for misplaced, empty, duplicate or unreadable games. Nothing is changed.';
  if (check?.available && !count)
    summary = `No problems found in ${check.checked === 1 ? '1 item' : `${check.checked} items`}.`;
  if (count)
    summary =
      count === 1 ? '1 thing to look at.' : `${count} things to look at.`;
  if (check?.truncated) summary += ' Only the first 20,000 items were checked.';
  return (
    <>
      <h2 className="group-heading">Library Check</h2>
      <section
        className="group"
        aria-label="Library check"
        aria-busy={checking}
      >
        <div className="row">
          <div className="row-text">
            <h3>
              <span className="title">Check for Problems</span>
            </h3>
            <p>{summary}</p>
          </div>
          {checking && <Spinner />}
          <button
            type="button"
            disabled={disabled || checking}
            onClick={() => {
              void run();
            }}
          >
            {check ? 'Check Again' : 'Check Library'}
          </button>
        </div>
        {check?.issues.map((issue) => (
          <div className="row" key={issue.id}>
            <div className="row-text">
              <h3>
                <span className="title">{base(issue.path)}</span>
              </h3>
              <p>{describeIssue(issue)}</p>
              <p className="path">{issue.path}</p>
            </div>
            {issue.movable ? (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Move ${base(issue.path)} to the ${issue.targetName} folder`}
                onClick={() => {
                  void operate('moving-game', () =>
                    window.mac.fixLibraryIssue(issue.id),
                  ).then(run);
                }}
              >
                Move to {issue.targetName}…
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Show ${base(issue.path)} in Finder`}
                onClick={() => {
                  void operate('revealing', () =>
                    window.mac.revealLibraryIssue(issue.id),
                  );
                }}
              >
                Show in Finder
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
