export function snapshotCoverage(metadata,latestSnapshotId,requestedEnd){
  if(!metadata)return null;
  const end=requestedEnd.replaceAll('-','');
  return {
    historicalVersion:Boolean(latestSnapshotId)&&metadata.snapshotId!==latestSnapshotId,
    endsBeforeRequest:/^\d{8}$/.test(end)&&metadata.asOf<end,
    asOf:metadata.asOf,
  };
}
