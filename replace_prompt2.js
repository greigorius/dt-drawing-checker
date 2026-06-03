const fs = require('fs');
const file = 'C:/Users/greig/Documents/ClaudeProjects/DTDrawingChecker/server/index.js';
let content = fs.readFileSync(file, 'utf8');

// Replace the reference-image-based opening paragraph with plain text guidance
const oldBlock = /You are extracting data from an architectural drawing title block\. This is page \$\{pageNumber\} of \$\{totalPages\} — extract from THIS PAGE ONLY\.\n\nIMPORTANT: A reference image.*?Field-by-field extraction guide \(refer to reference image\):/s;

const newBlock = `You are extracting data from an architectural drawing title block. This is page \${pageNumber} of \${totalPages} — extract from THIS PAGE ONLY.

The title block is in the BOTTOM-RIGHT CORNER of the page. Each field has a clear printed label. Read ONLY the value immediately to the right of or directly below each label.

Field-by-field extraction guide:`;

let newContent = content.replace(oldBlock, newBlock);
if (newContent === content) { console.error('FAILED: block not replaced'); process.exit(1); }

// Remove "orange highlight in reference" mention
newContent = newContent.replace(
  '- Three lines stacked vertically (orange highlight in reference)',
  '- Three lines stacked vertically in the Drawing Title/Description section'
);

// Remove reference image mention from checklist
newContent = newContent.replace(
  'FINAL CHECKLIST before returning (cross-check against the reference image):',
  'FINAL CHECKLIST before returning:'
);

// Remove reference image mention from quick-extract prompt
newContent = newContent.replace(
  'A reference image showing field locations is provided — use it to locate each field precisely. ',
  ''
);

fs.writeFileSync(file, newContent, 'utf8');
console.log('SUCCESS');
