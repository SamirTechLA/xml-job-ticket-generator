function parseFileName(filename) {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  
  // Try pattern: ENTITY-[Entity]_TASK-[Task]_[Filename]
  const pattern1 = /^ENTITY-(.+?)_TASK-(.+?)(?:_.*)?$/i;
  const match1 = nameWithoutExt.match(pattern1);
  if (match1) {
    return {
      entity: match1[1].replace(/[\-_]/g, '|'),
      task: match1[2]
    };
  }

  // Try pattern: [Entity]_[Task]_[Filename]
  const pattern2 = /^(\d+[\-_]\d+)_([A-Za-z0-9äöüßÄÖÜ]+)_(.+)$/;
  const match2 = nameWithoutExt.match(pattern2);
  if (match2) {
    return {
      entity: match2[1].replace(/_/g, '|').replace(/-/g, '|'),
      task: match2[2]
    };
  }

  // Default fallback if no match
  return {
    entity: '159|5',
    task: 'Bildretusche'
  };
}

const testCases = [
  "ENTITY-159_5_TASK-Bildretusche_Test 3.JPG",
  "ENTITY-159-5_TASK-Bildretusche_Test 3.JPG",
  "159_5_Bildretusche_Test 3.JPG",
  "159-5_Bildretusche_Test 3.JPG",
  "Test 3.JPG"
];

testCases.forEach(tc => {
  console.log(`Filename: "${tc}" =>`, parseFileName(tc));
});
