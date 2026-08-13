/**
 * Physical inputs — a turntable, a CD player, a line-in jack.
 *
 * Server-level rather than per zone, which is why the list is fetched once: an input is a
 * configured source with a capture bridge behind it, selectable from any zone. Switching is
 * `PUT /zones/{id}/input`, and there is no counterpart for leaving — you select something
 * else, and the server tears the old source down as part of that.
 *
 * `controllable` and `reportsMetadata` are honest about what an input can do: a bare jack
 * answers no transport commands and reports no metadata, so this labels it rather than
 * offering buttons that do nothing audible.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/state/ServerContext';
import { Icon } from '@/components/Icon';
import type { ApiInput, ApiZoneState } from '@/api/types';

export function InputsPanel({ zone }: { zone: ApiZoneState }) {
  const api = useApi();
  const [inputs, setInputs] = useState<ApiInput[] | null>(null);

  useEffect(() => {
    let current = true;
    api
      .getInputs()
      .then((list) => {
        if (current) {
          setInputs(list);
        }
      })
      .catch(() => {
        if (current) {
          setInputs([]);
        }
      });
    return () => {
      current = false;
    };
  }, [api]);

  /*
   * This is a destination now, reached from the rail, so it has to say something.
   * It used to return `null` when the list was empty, which was right while it was embedded in
   * another screen and wrong the moment it became the whole column — a blank main area reads as a
   * broken page rather than as an empty list. The rail only offers the entry when the server has an
   * input, so this is the racing case: the list emptied, or the fetch failed.
   */
  if (!inputs) {
    return <p className="hint">Loading…</p>;
  }
  if (inputs.length === 0) {
    return (
      <div className="content-empty">
        <Icon name="input" className="content-empty-icon" />
        <h2>No inputs</h2>
        <p>
          A turntable, a CD player or a line-in jack appears here once it is configured on the
          server.
        </p>
      </div>
    );
  }

  // `source.id` reports the same id an input was selected by, which closes the loop:
  // you can see a zone is on a line-in *and* which one.
  const activeId = zone.source?.kind === 'linein' ? zone.source.id : undefined;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Inputs</h2>
      </header>
      <ul className="item-list">
        {inputs.map((input) => (
          <li key={input.id}>
            <button
              type="button"
              className="item-row"
              data-current={input.id === activeId || undefined}
              onClick={() => void api.selectInput(zone.id, input.id)}
              title={`Switch ${zone.name} to ${input.name}`}
            >
              <span className="cover tiny" data-empty>
                <Icon name="input" />
              </span>
              <span className="item-text">
                <span className="item-title">{input.name}</span>
                <span className="item-sub">
                  {input.controllable ? 'Remote-controllable' : 'Select-only'}
                  {input.reportsMetadata ? ' · reports metadata' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
