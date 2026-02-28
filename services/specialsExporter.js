const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  BorderStyle, convertInchesToTwip,
} = require('docx');
const { getDb } = require('../db/database');

/**
 * Generate a .docx buffer for the weekly specials of a given week.
 *
 * Format per special:
 *   Dish Name - $Price
 *   Description
 *
 *   Tasting notes
 *   [special notes text]
 *
 *   Allergens
 *   [comma-separated allergens]
 *   Ingredients: [comma-separated ingredient names]
 *
 *   [service_notes — shown as-is, may contain "Food runner spiel" etc.]
 *
 * @param {string} weekStart  YYYY-MM-DD (Monday of the week)
 * @returns {Promise<Buffer>}  .docx file bytes
 */
async function exportSpecialsDocx(weekStart) {
  const db = getDb();

  // Compute week end (Sunday)
  const startDate = new Date(weekStart + 'T00:00:00');
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const weekEnd = endDate.toISOString().split('T')[0];

  // Fetch active specials for this week
  const specials = db.prepare(`
    SELECT ws.*, d.name AS dish_name, d.description AS dish_description,
           d.category, d.suggested_price, d.service_notes
    FROM weekly_specials ws
    JOIN dishes d ON d.id = ws.dish_id
    WHERE ws.week_start <= ? AND ws.week_end >= ? AND ws.is_active = 1 AND d.deleted_at IS NULL
    ORDER BY d.category, d.name
  `).all(weekStart, weekStart);

  if (!specials.length) {
    throw new Error('No active specials found for this week.');
  }

  // For each special, fetch allergens and ingredients
  const allergenStmt = db.prepare('SELECT allergen FROM dish_allergens WHERE dish_id = ?');
  const ingredientStmt = db.prepare(`
    SELECT i.name
    FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
    ORDER BY di.sort_order, di.id
  `);

  const sections = [];

  for (const s of specials) {
    s.allergens = allergenStmt.all(s.dish_id).map(a => a.allergen);
    s.ingredients = ingredientStmt.all(s.dish_id).map(r => r.name);

    const children = [];

    // ── Title: "Dish Name - $Price" or just "Dish Name" ──
    const titleText = s.suggested_price
      ? `${s.dish_name} - $${Number(s.suggested_price).toFixed(0)}`
      : s.dish_name;

    children.push(new Paragraph({
      children: [new TextRun({ text: titleText, bold: true, size: 28, font: 'Calibri' })],
      spacing: { after: 80 },
    }));

    // ── Description ──
    if (s.dish_description) {
      children.push(new Paragraph({
        children: [new TextRun({ text: s.dish_description, italics: true, size: 22, font: 'Calibri' })],
        spacing: { after: 160 },
      }));
    }

    // ── Tasting notes (from special's notes field) ──
    if (s.notes) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Tasting notes', bold: true, size: 22, font: 'Calibri' })],
        spacing: { after: 40 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: s.notes, size: 22, font: 'Calibri' })],
        spacing: { after: 160 },
      }));
    }

    // ── Allergens ──
    if (s.allergens.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Allergens', bold: true, size: 22, font: 'Calibri' })],
        spacing: { after: 40 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({
          text: s.allergens.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', '),
          size: 22,
          font: 'Calibri',
        })],
        spacing: { after: 80 },
      }));
    }

    // ── Ingredients ──
    if (s.ingredients.length) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Ingredients: ', bold: true, size: 22, font: 'Calibri' }),
          new TextRun({ text: s.ingredients.join(', '), size: 22, font: 'Calibri' }),
        ],
        spacing: { after: 160 },
      }));
    }

    // ── Service notes (food runner spiel, serve instructions, etc.) ──
    if (s.service_notes && s.service_notes.trim()) {
      const noteLines = s.service_notes.trim().split(/\n/);
      for (const line of noteLines) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 22, font: 'Calibri' })],
          spacing: { after: 40 },
        }));
      }
    }

    // ── Separator between specials ──
    children.push(new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 8 },
      },
    }));

    sections.push(...children);
  }

  // ── Build document ──
  const weekRangeLabel = formatWeekRange(weekStart, weekEnd);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.8),
            bottom: convertInchesToTwip(0.8),
            left: convertInchesToTwip(0.8),
            right: convertInchesToTwip(0.8),
          },
        },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Weekly Specials', bold: true, size: 36, font: 'Calibri' })],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: weekRangeLabel, size: 22, color: '666666', font: 'Calibri' })],
          spacing: { after: 300 },
        }),
        ...sections,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

function formatWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts = { month: 'long', day: 'numeric', year: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', opts)}`;
}

module.exports = { exportSpecialsDocx };
