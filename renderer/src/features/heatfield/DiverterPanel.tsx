// Diverter side panel (H12): peak tile temperature, peak heat flux, status against the illustrative tile limit
// (icon + words, never colour alone) and one field-adjustment toggle per diverter.
import { Icon, StatusPill, formatNumber } from '../../design';

export interface DiverterRow {
  id: string;
  label: string;
  /** °C */
  peakTileC: number;
  /** MW/m² */
  peakHeatFlux: number;
  /** Strike-line θ now (degrees). */
  strikeDeg: number;
  on: boolean;
}

export interface DiverterPanelProps {
  rows: DiverterRow[];
  /** Illustrative tile limit (°C). */
  limit: number;
  onToggle: (k: number, on: boolean) => void;
  onAllOff: () => void;
}

export function LimitStatus({ value, limit }: { value: number; limit: number }) {
  const over = value > limit;
  return (
    <span className="hf-limit" data-over={over ? 'true' : 'false'}>
      <Icon name={over ? 'alert' : 'check'} size={14} />
      {over ? 'Above limit' : 'Below limit'}
    </span>
  );
}

export function DiverterPanel({ rows, limit, onToggle, onAllOff }: DiverterPanelProps) {
  const anyOn = rows.some((r) => r.on);
  const over = rows.filter((r) => r.peakTileC > limit).map((r) => r.id);
  return (
    <div className="hf-div">
      <div className="hf-table-wrap" role="region" aria-label="Diverter table" tabIndex={0}>
        <table className="hf-table hf-div__table">
          <caption className="lab-visually-hidden">
            Peak tile temperature, peak heat flux and status against the {formatNumber(limit, 0)} °C illustrative tile limit for each
            diverter, with its field-adjustment toggle. Model values.
          </caption>
          <thead>
            <tr>
              <th scope="col">Diverter</th>
              <th scope="col" className="hf-num">
                Peak tile (°C)
              </th>
              <th scope="col" className="hf-num">
                Peak heat flux (MW/m²)
              </th>
              <th scope="col">vs {formatNumber(limit, 0)} °C limit</th>
              <th scope="col">Field adjustment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={r.id} data-diverter={r.id} data-over={r.peakTileC > limit ? 'true' : 'false'}>
                <th scope="row">
                  <span className="hf-div__name">{r.id}</span>
                  <span className="hf-div__where">φ {r.label.replace(`${r.id} · `, '')}</span>
                  <span className="hf-div__where lab-num" title="Strike line: the θ where the heat lands now">
                    θ<sub>s</sub> {formatNumber(r.strikeDeg, 1)}°
                  </span>
                </th>
                <td className="hf-num lab-num">{formatNumber(r.peakTileC, 0)}</td>
                <td className="hf-num lab-num">{formatNumber(r.peakHeatFlux, 2)}</td>
                <td>
                  <LimitStatus value={r.peakTileC} limit={limit} />
                </td>
                <td>
                  <button
                    type="button"
                    className="hf-toggle"
                    aria-pressed={r.on}
                    aria-label={`Field adjustment ${r.id}`}
                    onClick={() => onToggle(k, !r.on)}
                  >
                    <span className="hf-toggle__track" aria-hidden="true">
                      <span className="hf-toggle__thumb" />
                    </span>
                    <span aria-hidden="true">{r.on ? 'On' : 'Off'}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hf-div__foot">
        <button type="button" className="hf-btn" onClick={onAllOff} disabled={!anyOn}>
          All adjustments off
        </button>
        <p className="hf-small" data-testid="diverter-verdict">
          <StatusPill status="model" />{' '}
          {over.length === 0
            ? `Every diverter is below the illustrative ${formatNumber(limit, 0)} °C tile limit.`
            : `${over.join(', ')} ${over.length === 1 ? 'is' : 'are'} above the illustrative ${formatNumber(limit, 0)} °C tile limit.`}{' '}
          A field adjustment switches that diverter's control coil on: it perturbs |B| by ε and sweeps the strike line θ<sub>s</sub> (where
          the heat lands) up and down the target, from the current model time.
        </p>
      </div>
    </div>
  );
}
