// Validation: the evidence a reviewer checks first, on one route. The field-line tracer against stella
// (geometry.json: ρ 0.7 printed table, float64 out.nc, the 129-sample bean acceptance), then the archived
// stella and GENE heat-flux traces with their window means, uncertainty and claim gate (transport.json).
// Both panels are the reviewed task-01 and task-02 views, unchanged; this file only places them.
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { ValidationPanel } from '../geometry/ValidationPanel';
import { checkGeometry, type GeometryArtifact } from '../geometry/types';
import { TransportView } from '../transport/TransportView';
import '../geometry/geometry.css';
import './validation.css';

const VIEW = 'Validation';
const FILE = 'artifacts/geometry.json';

export function ValidationView() {
  const geometry = useArtifact<GeometryArtifact>('geometry');
  return (
    <div className="val-layout">
      <ArtifactGate state={geometry} view={VIEW} file={FILE} validate={checkGeometry}>
        {(g) => <ValidationPanel g={g} />}
      </ArtifactGate>
      <TransportView />
    </div>
  );
}
