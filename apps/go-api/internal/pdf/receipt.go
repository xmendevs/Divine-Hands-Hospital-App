// Package pdf renders printable documents for the core service.
package pdf

import (
	"bytes"
	"fmt"
	"math"
	"strings"

	"github.com/go-pdf/fpdf"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const (
	margin      = 12.0
	pageWidth   = 210.0 // A4
	usableWidth = pageWidth - 2*margin

	itemColWidth   = 116.0
	qtyColWidth    = 30.0
	amountColWidth = 40.0

	inkDark  = 17
	inkMuted = 120
	fillGray = 245
)

// Receipt renders an A4 payment receipt for a domain.Receipt.
func Receipt(re *domain.Receipt) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(margin, margin, margin)
	pdf.SetAutoPageBreak(true, 20)
	pdf.AddPage()

	patientName := re.PatientName
	if patientName == "" {
		patientName = re.PayerName
	}
	if patientName == "" {
		patientName = "Walk-in"
	}

	y := margin

	// Header.
	pdf.SetFont("Helvetica", "B", 20)
	pdf.SetTextColor(inkDark, inkDark, inkDark)
	pdf.SetXY(margin, y)
	pdf.CellFormat(usableWidth, 9, "Divine Hands Hospital", "", 1, "C", false, 0, "")
	y += 9

	pdf.SetFont("Helvetica", "", 11)
	pdf.SetTextColor(inkMuted, inkMuted, inkMuted)
	pdf.SetXY(margin, y)
	pdf.CellFormat(usableWidth, 6, "Official Payment Receipt", "", 1, "C", false, 0, "")
	y += 6

	pdf.SetDrawColor(inkDark, inkDark, inkDark)
	pdf.SetLineWidth(0.4)
	pdf.Line(margin, y+1, pageWidth-margin, y+1)
	y += 5

	// Receipt metadata.
	pdf.SetFont("Helvetica", "", 10)
	pdf.SetTextColor(inkDark, inkDark, inkDark)
	row := func(label, value string) {
		pdf.SetXY(margin, y)
		pdf.SetFont("Helvetica", "B", 10)
		pdf.CellFormat(36, 6, label, "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 10)
		pdf.CellFormat(usableWidth-36, 6, value, "", 1, "L", false, 0, "")
		y += 6
	}
	row("Receipt No", re.ReceiptNo)
	row("Invoice", re.InvoiceNo)
	row("Date", re.IssuedAt.UTC().Format("2006-01-02 15:04"))
	row("Received from", patientName)
	row("Payer", strings.ToUpper(re.BillTo))
	if re.PayerName != "" {
		row("Payer name", re.PayerName)
	}
	y += 2

	// Items table header.
	drawRow := func(name, qty, amount string, header bool) {
		pdf.SetXY(margin, y)
		if header {
			pdf.SetFillColor(fillGray, fillGray, fillGray)
			pdf.SetFont("Helvetica", "B", 10)
		} else {
			pdf.SetFont("Helvetica", "", 10)
		}
		pdf.CellFormat(itemColWidth, 7, name, "1", 0, "L", header, 0, "")
		pdf.CellFormat(qtyColWidth, 7, qty, "1", 0, "R", header, 0, "")
		pdf.CellFormat(amountColWidth, 7, amount, "1", 1, "R", header, 0, "")
		y += 7
	}
	drawRow("Item", "Qty", "Amount", true)
	for _, it := range re.Items {
		drawRow(truncate(it.Name, 42), fmt.Sprintf("%s x %s", truncate(it.Code, 12), trimZeros(it.Quantity)), money(re.Currency, it.LineTotal), false)
	}

	// Totals.
	y += 2
	totalRow := func(label, value string, bold bool) {
		pdf.SetXY(margin, y)
		if bold {
			pdf.SetFont("Helvetica", "B", 11)
		} else {
			pdf.SetFont("Helvetica", "", 10)
		}
		pdf.CellFormat(itemColWidth+qtyColWidth, 6.5, label, "", 0, "R", false, 0, "")
		pdf.CellFormat(amountColWidth, 6.5, value, "", 1, "R", false, 0, "")
		y += 6.5
	}
	totalRow("Invoice total", money(re.Currency, re.TotalAmount), false)
	totalRow("Amount paid", money(re.Currency, re.AmountPaid), false)
	y += 1
	pdf.SetDrawColor(inkDark, inkDark, inkDark)
	pdf.Line(margin, y-1, pageWidth-margin, y-1)
	paidLabel := fmt.Sprintf("Paid by %s", strings.ToUpper(re.Method))
	if re.Reference != "" {
		paidLabel += fmt.Sprintf(" (ref %s)", re.Reference)
	}
	totalRow(paidLabel, money(re.Currency, re.Amount), true)

	// Footer.
	y += 8
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(inkMuted, inkMuted, inkMuted)
	pdf.SetXY(margin, y)
	pdf.CellFormat(usableWidth, 5, fmt.Sprintf("Received by %s", truncate(re.ReceivedBy, 60)), "", 1, "L", false, 0, "")
	y += 5
	pdf.SetXY(margin, y)
	pdf.CellFormat(usableWidth, 5, "This is a system-generated receipt.", "", 1, "L", false, 0, "")

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// money renders a currency amount with thousands separators and two decimals.
func money(currency string, amount float64) string {
	return fmt.Sprintf("%s %s", currency, formatAmount(amount))
}

func formatAmount(v float64) string {
	n := int64(math.Round(v * 100))
	neg := n < 0
	if neg {
		n = -n
	}
	whole := n / 100
	frac := n % 100

	s := fmt.Sprintf("%d", whole)
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteByte(s[i])
	}
	out := fmt.Sprintf("%s.%02d", b.String(), frac)
	if neg {
		out = "-" + out
	}
	return out
}

func trimZeros(v float64) string {
	s := fmt.Sprintf("%.2f", v)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	return s
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "\u2026"
}
