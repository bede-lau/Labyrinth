// The equation used to predict heat movement and every parameter, read from the artifact (H16). Collapsible.
import { Fragment } from 'react';
import { Callout, formatNumber, trimNumber } from '../../design';
import { SubscriptText } from './SubscriptText';
import type { HeatfieldArtifact, ModelParameter } from './types';

export { SubscriptText };

/** A parameter symbol ("T_ped", "D_⊥0"): the same formatter. */
export const SymbolText = SubscriptText;

/** The label over the governing equation. */
export const GOVERNING_LABEL = 'Governing equation (used to predict how the heat moves)';

/**
 * The equation's meaning without a leading copy of GOVERNING_LABEL (the artifact's text starts with it, DZ3-5), its
 * first letter capitalised.
 */
export function meaningAfterLabel(meaning: string, label = GOVERNING_LABEL): string {
  if (!meaning.toLowerCase().startsWith(label.toLowerCase())) return meaning;
  const rest = meaning.slice(label.length).replace(/^[\s:.,;—–-]+/, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : meaning;
}

export interface EquationPanelProps {
  art: HeatfieldArtifact;
  /** The stability number computed by the port from the artifact. */
  stability: number;
}

/** The only explicit update, the tile relaxation, is monotone while Δt/τ_tile is at most 1 (the edge is quasi-steady). */
export const isStable = (stability: number) => stability <= 1;
export const UNSTABLE_TITLE = 'Tile update unstable: Δt exceeds τ_tile';

export function EquationPanel({ art, stability }: EquationPanelProps) {
  const [main, ...rest] = art.model.equations;
  const params = Object.entries(art.model.parameters) as [string, ModelParameter][];
  const stable = isStable(stability);
  return (
    <div className="hf-eq">
      {main && (
        <div className="hf-eq__main" data-testid="governing-equation">
          <p className="hf-eq__label">{GOVERNING_LABEL}</p>
          <p className="hf-eq__math" aria-label={`Equation: ${main.text}`}>
            <SubscriptText text={main.text} />
          </p>
          <p className="hf-eq__meaning">
            <SubscriptText text={meaningAfterLabel(main.meaning)} />
          </p>
        </div>
      )}
      {!stable && (
        <Callout tone="warn" title={<SubscriptText text={UNSTABLE_TITLE} />}>
          Δt/τ<sub>tile</sub> of this artifact is <span className="lab-num">{formatNumber(stability, 4)}</span>, above 1: the tile
          update overshoots, so the tile temperatures in this view can be wrong.
        </Callout>
      )}
      <details className="hf-details">
        <summary>Equations, parameters and discretisation</summary>
        <dl className="hf-eq__list">
          {rest.map((e) => (
            <Fragment key={e.id}>
              <dt className="hf-eq__math" aria-label={e.text}>
                <SubscriptText text={e.text} />
              </dt>
              <dd>
                <SubscriptText text={e.meaning} />
              </dd>
            </Fragment>
          ))}
        </dl>
        <div className="hf-table-wrap" role="region" aria-label="Model parameters" tabIndex={0}>
          <table className="hf-table hf-eq__params">
            <caption className="hf-loop__caption">Parameters as written in artifacts/heatfield.json (physics inputs at W7-X orders of magnitude; footprint, coil and tile parameters illustrative; none fitted)</caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="hf-num">
                  Value
                </th>
                <th scope="col">Unit</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {params.map(([name, p]) => (
                <tr key={name} data-parameter={name}>
                  <th scope="row">
                    <SymbolText text={p.symbol} />
                  </th>
                  <td className="hf-num lab-num">{trimNumber(p.value)}</td>
                  <td>{p.unit}</td>
                  <td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hf-small" data-testid="stability">
          Stability (the edge is quasi-steady; the only explicit update is the tile relaxation): Δt/τ<sub>tile</sub> ={' '}
          <span className="lab-num">{formatNumber(stability, 4)}</span>{' '}
          {stable ? '≤ 1, computed here from the artifact.' : '> 1, computed here from the artifact: the tile update is unstable.'}
        </p>
        <h4 className="hf-eq__h">Discretisation</h4>
        <p className="hf-eq__prose">{art.model.discretization}</p>
        <h4 className="hf-eq__h">Limitations</h4>
        <p className="hf-eq__prose">{art.model.limitations}</p>
      </details>
    </div>
  );
}
