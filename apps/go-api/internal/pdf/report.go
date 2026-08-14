// Generic tabular report rendering for exports (Phase 12).
package pdf

import (
	"bytes"
	"fmt"
	"time"

	"github.com/go-pdf/fpdf"
)

const pageWidthLandscape = 297.0 // A4 landscape

func nowString() string {
	return time.Now().UTC().Format("2006-01-02 15:04 UTC")
}

// Report renders a tabular report on landscape A4 with a header row and
// automatic pagination. Wide cells are truncated, never wrapped.
func Report(title string, header []string, rows [][]string) ([]byte, error) {
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(margin, margin, margin)
	pdf.SetAutoPageBreak(true, 15)
	pdf.AddPage()

	usable := pageWidthLandscape - 2*margin
	colWidth := usable / float64(len(header))

	// Title.
	pdf.SetFont("Helvetica", "B", 14)
	pdf.SetTextColor(inkDark, inkDark, inkDark)
	pdf.SetXY(margin, margin)
	pdf.CellFormat(usable, 8, title, "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(inkMuted, inkMuted, inkMuted)
	pdf.SetXY(margin, margin+9)
	pdf.CellFormat(usable, 5, fmt.Sprintf("Generated %s", nowString()), "", 1, "L", false, 0, "")
	pdf.Ln(6)

	drawRow := func(cells []string, headerRow bool) {
		x := margin
		for _, c := range cells {
			text := c
			if headerRow {
				pdf.SetFillColor(fillGray, fillGray, fillGray)
				pdf.SetFont("Helvetica", "B", 8)
			} else {
				pdf.SetFont("Helvetica", "", 8)
			}
			pdf.SetX(x)
			pdf.CellFormat(colWidth, 6, truncate(text, 42), "1", 0, "L", headerRow, 0, "")
			x += colWidth
		}
		pdf.Ln(6)
	}

	drawRow(header, true)
	for _, r := range rows {
		drawRow(r, false)
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
