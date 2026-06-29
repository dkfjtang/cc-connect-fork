package feishu

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"unicode"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

var naturalDecisionThreadUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)

func plainText(content string) map[string]any {
	return map[string]any{"tag": "plain_text", "content": content}
}

func buildDecisionCard(dec core.Decision) *core.Card {
	title := strings.TrimSpace(dec.Title)
	if title == "" {
		title = "Decision required"
	}
	cb := core.NewCard().Title(title, "orange")
	if strings.TrimSpace(dec.Message) != "" {
		for _, line := range formatDecisionMessageMarkdownLines(dec.Message) {
			cb.Markdown(line)
		}
	}
	var buttons []core.CardButton
	for _, choice := range dec.Choices {
		typ := "default"
		if strings.EqualFold(choice, dec.Recommended) {
			typ = "primary"
		}
		buttons = append(buttons, core.CardButton{
			Text:  decisionChoiceLabel(choice),
			Type:  typ,
			Value: "decision:respond",
			Extra: map[string]string{
				"decision_id":     dec.ID,
				"decision_choice": choice,
			},
		})
	}
	cb.ButtonsEqual(buttons...)
	cb.TaggedNote("decision-card", "可选备注")
	return cb.Build()
}

func decisionChoiceLabel(choice string) string {
	switch strings.ToLower(strings.TrimSpace(choice)) {
	case "continue":
		return "继续"
	case "pause":
		return "暂停"
	case "revise":
		return "修改"
	case "ignore":
		return "忽略"
	case "remind_later":
		return "稍后提醒"
	case "reconnect":
		return "重连"
	case "stop", "abort":
		return "停止"
	case "approve", "accept", "allow", "yes", "confirm", "proceed":
		return "同意"
	case "reject", "decline", "deny", "no":
		return "拒绝"
	case "cancel":
		return "取消"
	case "retry":
		return "重试"
	case "skip":
		return "跳过"
	case "done", "complete":
		return "完成"
	default:
		return choice
	}
}

func formatDecisionMessageMarkdownLines(message string) []string {
	message = normalizeDecisionMessageLineBreaks(strings.TrimSpace(message))
	if message == "" {
		return nil
	}

	for _, label := range decisionMessageLabels() {
		message = insertLineBreakBeforeLabel(message, label)
	}

	lines := strings.Split(message, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		for _, readableLine := range splitNaturalDecisionMessageLine(line) {
			out = append(out, formatDecisionMessageLine(readableLine))
		}
	}
	return out
}

func normalizeDecisionMessageLineBreaks(message string) string {
	replacer := strings.NewReplacer(
		"\r\n", "\n",
		"\r", "\n",
		"`r`n", "\n",
		"`n", "\n",
	)
	return replacer.Replace(message)
}

func insertLineBreakBeforeLabel(message, label string) string {
	var b strings.Builder
	start := 0
	for {
		idx := strings.Index(message[start:], label)
		if idx < 0 {
			b.WriteString(message[start:])
			return b.String()
		}
		idx += start
		if idx > 0 && message[idx-1] != '\n' {
			b.WriteString(message[start:idx])
			b.WriteByte('\n')
		} else {
			b.WriteString(message[start:idx])
		}
		b.WriteString(label)
		start = idx + len(label)
	}
}

func formatDecisionMessageLine(line string) string {
	for _, label := range decisionMessageLabels() {
		if strings.HasPrefix(line, label) {
			value := strings.TrimSpace(strings.TrimPrefix(line, label))
			if value == "" {
				return "**" + label + "**"
			}
			return "**" + label + "** " + value
		}
	}
	return line
}

func splitNaturalDecisionMessageLine(line string) []string {
	line = strings.TrimSpace(line)
	if line == "" || hasDecisionMessageLabelPrefix(line) {
		return []string{line}
	}
	if fields := formatNaturalDecisionMessageFields(line); len(fields) > 0 {
		return fields
	}

	lines := []string{line}
	if idx := strings.Index(line, "。建议"); idx >= 0 {
		prefix := strings.TrimSpace(line[:idx+len("。")])
		suggestion := strings.TrimSpace(line[idx+len("。"):])
		lines = lines[:0]
		if prefix != "" {
			lines = append(lines, prefix)
		}
		if suggestion != "" {
			lines = append(lines, suggestion)
		}
	}

	out := make([]string, 0, len(lines))
	for _, candidate := range lines {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if strings.HasPrefix(candidate, "建议") {
			for _, part := range splitDecisionSuggestionParts(candidate) {
				part = strings.TrimSpace(part)
				if part != "" {
					out = append(out, part)
				}
			}
			continue
		}
		out = append(out, candidate)
	}
	if len(out) == 0 {
		return []string{line}
	}
	return out
}

func formatNaturalDecisionMessageFields(line string) []string {
	threadID, detail, ok := splitNaturalDecisionThread(line)
	if !ok {
		return nil
	}

	detail, suggestion := splitNaturalDecisionSuggestion(detail)
	out := []string{"线程： " + threadID}
	if detail != "" {
		out = append(out, naturalDecisionDetailLabel(detail)+" "+detail)
	}
	out = append(out, formatNaturalDecisionSuggestionFields(suggestion)...)
	if len(out) <= 1 {
		return nil
	}
	return out
}

func splitNaturalDecisionThread(line string) (string, string, bool) {
	for _, prefix := range []string{"目标线程 ", "线程 "} {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(line, prefix))
		if rest == "" {
			return "", "", false
		}
		if threadID := naturalDecisionThreadUUIDPattern.FindString(rest); threadID != "" {
			detail := strings.TrimSpace(strings.TrimPrefix(rest, threadID))
			return threadID, detail, detail != ""
		}
		threadEnd := len(rest)
		for idx, r := range rest {
			if unicode.IsSpace(r) || r == '（' || r == '(' {
				threadEnd = idx
				break
			}
		}
		threadID := strings.TrimSpace(rest[:threadEnd])
		if threadID == "" {
			return "", "", false
		}
		detail := strings.TrimSpace(rest[threadEnd:])
		return threadID, detail, detail != ""
	}
	return "", "", false
}

func splitNaturalDecisionSuggestion(detail string) (string, string) {
	before, after, ok := splitNaturalDecisionSuggestionMarker(detail)
	if !ok {
		return strings.TrimSpace(detail), ""
	}
	return before, after
}

func splitNaturalDecisionSuggestionMarker(detail string) (string, string, bool) {
	type suggestionMarker struct {
		marker    string
		separator string
	}
	markers := []suggestionMarker{
		{marker: "。建议", separator: "。"},
		{marker: "。推荐", separator: "。"},
		{marker: "，建议", separator: "，"},
		{marker: "，推荐", separator: "，"},
		{marker: "；建议", separator: "；"},
		{marker: "；推荐", separator: "；"},
	}
	bestIdx := -1
	var best suggestionMarker
	for _, marker := range markers {
		if idx := strings.Index(detail, marker.marker); idx >= 0 && (bestIdx < 0 || idx < bestIdx) {
			bestIdx = idx
			best = marker
		}
	}
	if bestIdx < 0 {
		return "", "", false
	}
	before := strings.TrimSpace(detail[:bestIdx+len(best.separator)])
	after := strings.TrimSpace(detail[bestIdx+len(best.separator):])
	return before, after, true
}

func naturalDecisionDetailLabel(detail string) string {
	if strings.HasPrefix(detail, "仍需要") || strings.Contains(detail, "需要 owner") || strings.Contains(detail, "需要用户") {
		return "需要用户决策："
	}
	return "最近进展："
}

func formatNaturalDecisionSuggestionFields(suggestion string) []string {
	suggestion = strings.TrimSpace(suggestion)
	if suggestion == "" {
		return nil
	}
	suggestion = strings.TrimSpace(strings.TrimPrefix(suggestion, "建议"))
	suggestion = strings.TrimSpace(strings.TrimPrefix(suggestion, "推荐"))
	if suggestion == "" {
		return nil
	}

	parts := splitDecisionSuggestionParts(suggestion)
	if len(parts) == 0 {
		return []string{"建议动作： " + suggestion}
	}

	out := make([]string, 0, len(parts))
	otherOptions := make([]string, 0)
	for i, raw := range parts {
		part := strings.TrimSpace(raw)
		if part == "" {
			continue
		}
		switch {
		case i == 0:
			out = append(out, "建议动作： "+part)
		case strings.HasPrefix(part, "备注为"):
			out = append(out, "备注： "+strings.TrimSpace(strings.TrimPrefix(part, "备注为")))
		case strings.HasPrefix(part, "备注："):
			out = append(out, "备注： "+strings.TrimSpace(strings.TrimPrefix(part, "备注：")))
		case strings.HasPrefix(part, "不要") || strings.HasPrefix(part, "不得") || strings.HasPrefix(part, "禁止"):
			out = append(out, "注意事项： "+part)
		default:
			otherOptions = append(otherOptions, part)
		}
	}
	if len(otherOptions) > 0 {
		out = append(out, "其他选项： "+strings.Join(otherOptions, "；"))
	}
	if len(out) == 0 {
		return []string{"建议动作： " + suggestion}
	}
	return out
}

func splitDecisionSuggestionParts(line string) []string {
	return strings.FieldsFunc(line, func(r rune) bool {
		return r == '；' || r == ';'
	})
}

func hasDecisionMessageLabelPrefix(line string) bool {
	for _, label := range decisionMessageLabels() {
		if strings.HasPrefix(line, label) {
			return true
		}
	}
	return false
}

func decisionMessageLabels() []string {
	return []string{
		"线程：",
		"线程标题：",
		"判断类型：",
		"最近进展：",
		"需要用户决策：",
		"需要用户决策的问题：",
		"建议动作：",
		"注意事项：",
		"其他选项：",
		"备注：",
	}
}

// ReplyCard sends a structured card as a reply to the original message.
func (p *interactivePlatform) ReplyCard(ctx context.Context, rctx any, card *core.Card) error {
	rc, ok := rctx.(replyContext)
	if !ok {
		return fmt.Errorf("%s: invalid reply context type %T", p.tag(), rctx)
	}

	cardJSON := renderCard(card, rc.sessionKey)
	if !p.shouldUseThreadOrReplyAPI(rc) {
		if rc.chatID == "" {
			return fmt.Errorf("%s: chatID is empty, cannot send card", p.tag())
		}
		return p.createMessage(ctx, rc.chatID, larkim.MsgTypeInteractive, cardJSON, "send card")
	}
	return p.replyMessage(ctx, rc, larkim.MsgTypeInteractive, cardJSON)
}

// SendCard sends a structured card as a new message to the chat.
func (p *interactivePlatform) SendCard(ctx context.Context, rctx any, card *core.Card) error {
	rc, ok := rctx.(replyContext)
	if !ok {
		return fmt.Errorf("%s: invalid reply context type %T", p.tag(), rctx)
	}
	if rc.chatID == "" {
		return fmt.Errorf("%s: chatID is empty, cannot send card", p.tag())
	}

	if !p.noReplyToTrigger && p.shouldReplyInThread(rc) {
		return p.ReplyCard(ctx, rctx, card)
	}

	cardJSON := renderCard(card, rc.sessionKey)
	return p.createMessage(ctx, rc.chatID, larkim.MsgTypeInteractive, cardJSON, "send card")
}

// RefreshCard updates a previously rendered card in-place using the Patch API.
// It looks up the messageID stored from the most recent card action callback
// for the given session key and patches that message with the new card content.
func (p *interactivePlatform) RefreshCard(ctx context.Context, sessionKey string, card *core.Card) error {
	p.cardActionMsgMu.Lock()
	msgID := p.cardActionMsgIDs[sessionKey]
	p.cardActionMsgMu.Unlock()

	if msgID == "" {
		return fmt.Errorf("%s: no tracked card messageID for session %q", p.tag(), sessionKey)
	}

	cardJSON := renderCard(card, sessionKey)
	req := larkim.NewPatchMessageReqBuilder().
		MessageId(msgID).
		Body(larkim.NewPatchMessageReqBodyBuilder().
			Content(cardJSON).
			Build()).
		Build()
	return p.withTransientRetry(ctx, "refresh card", func() error {
		return p.withFreshTenantAccessTokenRetry(ctx, "refresh card", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			resp, err := client.Im.Message.Patch(ctx, req, options...)
			if err != nil {
				return fmt.Errorf("%s: refresh card: %w", p.tag(), err)
			}
			if !resp.Success() {
				return fmt.Errorf("%s: refresh card code=%d msg=%s", p.tag(), resp.Code, resp.Msg)
			}
			return nil
		})
	})
}

// renderCardMap converts a core.Card into the Feishu Interactive Card map
// using the v1 format. Used both for message API (via renderCard) and
// callback responses (CardActionTriggerResponse).
func renderCardMap(card *core.Card, sessionKey string) map[string]any {
	result := map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
	}
	if card == nil {
		return result
	}

	if card.Header != nil && card.Header.Title != "" {
		color := card.Header.Color
		if color == "" {
			color = "blue"
		}
		result["header"] = map[string]any{
			"title":    plainText(card.Header.Title),
			"template": color,
		}
	}
	if transformed, ok := renderDeleteModeCheckerCard(card, result); ok {
		return transformed
	}
	if transformed, ok := renderDecisionCard(card, result); ok {
		return transformed
	}

	var elements []map[string]any
	for _, elem := range card.Elements {
		switch e := elem.(type) {
		case core.CardMarkdown:
			elements = append(elements, map[string]any{
				"tag":     "markdown",
				"content": e.Content,
			})
		case core.CardDivider:
			elements = append(elements, map[string]any{
				"tag": "hr",
			})
		case core.CardActions:
			var actions []map[string]any
			for _, btn := range e.Buttons {
				btnType := btn.Type
				if btnType == "" {
					btnType = "default"
				}
				valMap := map[string]string{"action": btn.Value}
				if sessionKey != "" {
					valMap["session_key"] = sessionKey
				}
				for k, v := range btn.Extra {
					valMap[k] = v
				}
				action := map[string]any{
					"tag":   "button",
					"text":  plainText(btn.Text),
					"type":  btnType,
					"value": valMap,
				}
				if e.Layout == core.CardActionLayoutEqualColumns {
					action["width"] = "fill"
				}
				actions = append(actions, action)
			}
			if len(actions) > 0 {
				if e.Layout == core.CardActionLayoutEqualColumns {
					columns := make([]map[string]any, 0, len(actions))
					for _, action := range actions {
						columns = append(columns, map[string]any{
							"tag":              "column",
							"width":            "weighted",
							"weight":           1,
							"vertical_align":   "center",
							"horizontal_align": "center",
							"elements":         []map[string]any{action},
						})
					}
					columnSet := map[string]any{
						"tag":     "column_set",
						"columns": columns,
					}
					if len(actions) == 2 {
						columnSet["flex_mode"] = "bisect"
					}
					elements = append(elements, columnSet)
				} else {
					elements = append(elements, map[string]any{
						"tag":     "action",
						"actions": actions,
					})
				}
			}
		case core.CardListItem:
			btnType := e.BtnType
			if btnType == "" {
				btnType = "default"
			}
			valMap := map[string]string{"action": e.BtnValue}
			if sessionKey != "" {
				valMap["session_key"] = sessionKey
			}
			for k, v := range e.Extra {
				valMap[k] = v
			}
			elements = append(elements, map[string]any{
				"tag":       "column_set",
				"flex_mode": "none",
				"columns": []map[string]any{
					{
						"tag":            "column",
						"width":          "weighted",
						"weight":         5,
						"vertical_align": "center",
						"elements": []map[string]any{
							{
								"tag":     "markdown",
								"content": e.Text,
							},
						},
					},
					{
						"tag":            "column",
						"width":          "auto",
						"vertical_align": "center",
						"elements": []map[string]any{
							{
								"tag":   "button",
								"text":  plainText(e.BtnText),
								"type":  btnType,
								"value": valMap,
							},
						},
					},
				},
			})
		case core.CardSelect:
			var options []map[string]any
			for _, opt := range e.Options {
				options = append(options, map[string]any{
					"text":  plainText(opt.Text),
					"value": opt.Value,
				})
			}
			selectElem := map[string]any{
				"tag":         "select_static",
				"placeholder": plainText(e.Placeholder),
				"options":     options,
			}
			if sessionKey != "" {
				selectElem["value"] = map[string]string{"session_key": sessionKey}
			}
			if e.InitValue != "" {
				selectElem["initial_option"] = e.InitValue
			}
			elements = append(elements, map[string]any{
				"tag":     "action",
				"actions": []map[string]any{selectElem},
			})
		case core.CardNote:
			elements = append(elements, map[string]any{
				"tag":      "note",
				"elements": []map[string]any{plainText(e.Text)},
			})
		}
	}

	if len(elements) == 0 {
		elements = []map[string]any{{"tag": "markdown", "content": " "}}
	}

	result["elements"] = elements
	return result
}

type deleteModeCheckerRow struct {
	id      string
	text    string
	checked bool
}

func renderDeleteModeCheckerCard(card *core.Card, base map[string]any) (map[string]any, bool) {
	if card == nil {
		return nil, false
	}

	formRowElements := make([]map[string]any, 0)
	notes := make([]core.CardNote, 0)
	navRows := make([]core.CardActions, 0)
	submitText := ""
	cancelText := ""

	for _, elem := range card.Elements {
		switch e := elem.(type) {
		case core.CardListItem:
			id, selectable, ok := parseDeleteModeListItemAction(e.BtnValue)
			if !ok {
				return nil, false
			}
			text := normalizeDeleteModeCheckerText(e.Text)
			if !selectable {
				formRowElements = append(formRowElements, map[string]any{
					"tag":     "markdown",
					"content": "▶ " + text,
				})
				continue
			}
			row := deleteModeCheckerRow{
				id:      id,
				text:    text,
				checked: strings.Contains(e.Text, "☑"),
			}
			formRowElements = append(formRowElements, map[string]any{
				"tag":     "checker",
				"name":    deleteModeCheckerName(row.id),
				"checked": row.checked,
				"text": map[string]any{
					"tag":     "lark_md",
					"content": row.text,
				},
			})
		case core.CardNote:
			notes = append(notes, e)
		case core.CardActions:
			remaining := make([]core.CardButton, 0, len(e.Buttons))
			for _, btn := range e.Buttons {
				switch btn.Value {
				case "act:/delete-mode confirm":
					submitText = btn.Text
				case "act:/delete-mode cancel":
					cancelText = btn.Text
				default:
					remaining = append(remaining, btn)
				}
			}
			if len(remaining) > 0 {
				navRows = append(navRows, core.CardActions{Buttons: remaining, Layout: e.Layout})
			}
		case core.CardMarkdown, core.CardDivider, core.CardSelect:
			return nil, false
		}
	}

	if len(formRowElements) == 0 || submitText == "" {
		return nil, false
	}

	elements := make([]map[string]any, 0, len(notes)+1+len(navRows))
	for _, n := range notes {
		if n.Text == "" {
			continue
		}
		if n.Tag == "delete-mode-selected-count" {
			continue
		}
		elements = append(elements, map[string]any{
			"tag":      "note",
			"elements": []map[string]any{plainText(n.Text)},
		})
	}
	formElements := append([]map[string]any{}, formRowElements...)

	buttonColumns := []map[string]any{
		{
			"tag":            "column",
			"width":          "auto",
			"vertical_align": "center",
			"elements": []map[string]any{
				{
					"tag":              "button",
					"text":             plainText(submitText),
					"type":             "danger",
					"name":             "delete_mode_submit",
					"form_action_type": "submit",
					"value":            map[string]string{"action": "act:/delete-mode form-submit"},
				},
			},
		},
	}
	if cancelText != "" {
		buttonColumns = append(buttonColumns, map[string]any{
			"tag":            "column",
			"width":          "auto",
			"vertical_align": "center",
			"elements": []map[string]any{
				{
					"tag":   "button",
					"text":  plainText(cancelText),
					"type":  "default",
					"name":  "delete_mode_cancel",
					"value": map[string]string{"action": "act:/delete-mode cancel"},
				},
			},
		})
	}
	formElements = append(formElements, map[string]any{
		"tag":              "column_set",
		"horizontal_align": "left",
		"columns":          buttonColumns,
	})

	elements = append(elements, map[string]any{
		"tag":      "form",
		"name":     "delete_mode_form",
		"elements": formElements,
	})

	for _, row := range navRows {
		actions := make([]map[string]any, 0, len(row.Buttons))
		for _, btn := range row.Buttons {
			btnType := btn.Type
			if btnType == "" {
				btnType = "default"
			}
			valMap := map[string]string{"action": btn.Value}
			for k, v := range btn.Extra {
				valMap[k] = v
			}
			action := map[string]any{
				"tag":   "button",
				"text":  plainText(btn.Text),
				"type":  btnType,
				"value": valMap,
			}
			if row.Layout == core.CardActionLayoutEqualColumns {
				action["width"] = "fill"
			}
			actions = append(actions, action)
		}
		if len(actions) > 0 {
			elements = append(elements, map[string]any{
				"tag":     "action",
				"actions": actions,
			})
		}
	}

	base["elements"] = elements
	return base, true
}

func renderDecisionCard(card *core.Card, base map[string]any) (map[string]any, bool) {
	if card == nil {
		return nil, false
	}
	isDecision := false
	var formElements []map[string]any
	var buttons []core.CardButton
	for _, elem := range card.Elements {
		switch e := elem.(type) {
		case core.CardNote:
			if e.Tag == "decision-card" {
				isDecision = true
			}
		case core.CardMarkdown:
			formElements = append(formElements, map[string]any{
				"tag":     "markdown",
				"content": e.Content,
			})
		case core.CardActions:
			buttons = append(buttons, e.Buttons...)
		case core.CardDivider:
			formElements = append(formElements, map[string]any{"tag": "hr"})
		default:
			return nil, false
		}
	}
	if !isDecision || len(buttons) == 0 {
		return nil, false
	}

	formElements = append(formElements, map[string]any{
		"tag":         "input",
		"name":        "decision_comment",
		"placeholder": plainText(decisionCommentPlaceholder(card)),
	})

	buttonColumns := make([]map[string]any, 0, len(buttons))
	for i, btn := range buttons {
		btnType := btn.Type
		if btnType == "" {
			btnType = "default"
		}
		valMap := map[string]string{"action": btn.Value}
		for k, v := range btn.Extra {
			valMap[k] = v
		}
		buttonColumns = append(buttonColumns, map[string]any{
			"tag":            "column",
			"width":          "weighted",
			"weight":         1,
			"vertical_align": "center",
			"elements": []map[string]any{
				{
					"tag":              "button",
					"text":             plainText(btn.Text),
					"type":             btnType,
					"name":             decisionSubmitName(btn, i),
					"form_action_type": "submit",
					"value":            valMap,
				},
			},
		})
	}
	for _, row := range chunkColumns(buttonColumns, 3) {
		columnSet := map[string]any{
			"tag":              "column_set",
			"horizontal_align": "left",
			"columns":          row,
		}
		if len(row) == 2 {
			columnSet["flex_mode"] = "bisect"
		}
		formElements = append(formElements, columnSet)
	}

	base["elements"] = []map[string]any{
		{
			"tag":      "form",
			"name":     "decision_form",
			"elements": formElements,
		},
	}
	return base, true
}

func decisionSubmitName(btn core.CardButton, index int) string {
	decisionID := strings.TrimSpace(btn.Extra["decision_id"])
	choice := strings.TrimSpace(btn.Extra["decision_choice"])
	if decisionID == "" || choice == "" {
		return fmt.Sprintf("decision_submit_%d", index)
	}
	return "decision_submit_v1_" + hex.EncodeToString([]byte(decisionID)) + "_" + hex.EncodeToString([]byte(choice))
}

func decisionCommentPlaceholder(card *core.Card) string {
	if card == nil {
		return "可选备注"
	}
	for _, elem := range card.Elements {
		note, ok := elem.(core.CardNote)
		if ok && note.Tag == "decision-card" && strings.TrimSpace(note.Text) != "" {
			return note.Text
		}
	}
	return "可选备注"
}

func chunkColumns(columns []map[string]any, size int) [][]map[string]any {
	if size <= 0 || len(columns) == 0 {
		return nil
	}
	rows := make([][]map[string]any, 0, (len(columns)+size-1)/size)
	for start := 0; start < len(columns); start += size {
		end := start + size
		if end > len(columns) {
			end = len(columns)
		}
		rows = append(rows, columns[start:end])
	}
	return rows
}

func normalizeDeleteModeCheckerText(text string) string {
	trimmed := strings.TrimSpace(text)
	for _, prefix := range []string{"☑ ▶", "◻ ▶", "▶", "☑", "◻"} {
		if strings.HasPrefix(trimmed, prefix) {
			trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, prefix))
			break
		}
	}
	return trimmed
}

func parseDeleteModeListItemAction(action string) (id string, selectable bool, ok bool) {
	const (
		togglePrefix = "act:/delete-mode toggle "
		noopPrefix   = "act:/delete-mode noop "
	)
	switch {
	case strings.HasPrefix(action, togglePrefix):
		id = strings.TrimSpace(strings.TrimPrefix(action, togglePrefix))
		return id, true, id != ""
	case strings.HasPrefix(action, noopPrefix):
		id = strings.TrimSpace(strings.TrimPrefix(action, noopPrefix))
		return id, false, id != ""
	default:
		return "", false, false
	}
}

// renderCard converts a core.Card into the Feishu Interactive Card JSON string.
func renderCard(card *core.Card, sessionKey string) string {
	b, err := json.Marshal(renderCardMap(card, sessionKey))
	if err != nil {
		slog.Error("feishu: renderCard marshal failed", "error", err)
		return `{"config":{"wide_screen_mode":true},"elements":[]}`
	}
	return string(b)
}
