// Shared column header for PairingRow tables. Kept in sync with the
// 6-column layout in PairingRow (board | white | result | black |
// scheduled | attention).
export function PairingTableHead() {
  return (
    <thead>
      <tr className="text-muted-foreground border-border border-b text-xs uppercase tracking-wide">
        <th className="px-3 py-2 text-center font-normal">Bd</th>
        <th className="px-3 py-2 text-left font-normal">White</th>
        <th className="px-3 py-2 text-center font-normal">Result</th>
        <th className="px-3 py-2 text-left font-normal">Black</th>
        <th className="px-3 py-2 text-left font-normal">Scheduled</th>
        <th className="px-3 py-2 text-right font-normal">Attention</th>
      </tr>
    </thead>
  );
}
