import fs from 'node:fs';

const path = 'src/hooks/usePlannerDataState.ts';
const source = fs.readFileSync(path, 'utf8');
const before = `        setStudyMaterials((current) =>
          sortStudyMaterials(
            progress.nextMaterials.map((nextMaterial) => {
              const currentMaterial = current.find((material) => material.id === nextMaterial.id);
              return currentMaterial ? { ...currentMaterial, ...nextMaterial } : nextMaterial;
            }),
          ),
        );`;
const after = `        setStudyMaterials((current) =>
          sortStudyMaterials(
            progress.changedMaterials.reduce(
              (records, nextMaterial) =>
                upsertByKey(records, nextMaterial, (material) => material.id),
              current,
            ),
          ),
        );`;

const occurrences = source.split(before).length - 1;
if (occurrences !== 2) {
  throw new Error(`Expected 2 stale material projections, found ${occurrences}.`);
}

fs.writeFileSync(path, source.split(before).join(after));
console.log('Stale material state projections replaced.');
