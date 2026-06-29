package feishu

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func decodeRenderedCard(t *testing.T, card *core.Card) map[string]any {
	t.Helper()

	var got map[string]any
	if err := json.Unmarshal([]byte(renderCard(card, "")), &got); err != nil {
		t.Fatalf("renderCard JSON decode failed: %v", err)
	}
	return got
}

func decisionCardMarkdownContents(t *testing.T, got map[string]any) []string {
	t.Helper()

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one decision form", got["elements"])
	}
	form, ok := elements[0].(map[string]any)
	if !ok || form["tag"] != "form" {
		t.Fatalf("first element = %#v, want form", elements[0])
	}
	formElements, ok := form["elements"].([]any)
	if !ok {
		t.Fatalf("form elements = %#v, want array", form["elements"])
	}

	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	return markdownContents
}

func decisionCardButtons(t *testing.T, got map[string]any) []map[string]any {
	t.Helper()

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one decision form", got["elements"])
	}
	form, ok := elements[0].(map[string]any)
	if !ok || form["tag"] != "form" {
		t.Fatalf("first element = %#v, want form", elements[0])
	}
	formElements, ok := form["elements"].([]any)
	if !ok {
		t.Fatalf("form elements = %#v, want array", form["elements"])
	}

	var buttons []map[string]any
	for _, elem := range formElements {
		columnSet, ok := elem.(map[string]any)
		if !ok || columnSet["tag"] != "column_set" {
			continue
		}
		columns, ok := columnSet["columns"].([]any)
		if !ok {
			t.Fatalf("column_set columns = %#v, want array", columnSet["columns"])
		}
		for _, colRaw := range columns {
			col, ok := colRaw.(map[string]any)
			if !ok {
				t.Fatalf("column = %#v, want object", colRaw)
			}
			inner, ok := col["elements"].([]any)
			if !ok || len(inner) != 1 {
				t.Fatalf("column elements = %#v, want one button", col["elements"])
			}
			button, ok := inner[0].(map[string]any)
			if !ok || button["tag"] != "button" {
				t.Fatalf("column element = %#v, want button", inner[0])
			}
			buttons = append(buttons, button)
		}
	}
	return buttons
}

func TestRenderCardMap_EqualColumnsActionsUseColumnSet(t *testing.T) {
	buttons := []core.CardButton{
		core.PrimaryBtn("Session Management", "nav:/help session"),
		core.DefaultBtn("Agent Configuration", "nav:/help agent"),
		core.DefaultBtn("Tools & Automation", "nav:/help tools"),
		core.DefaultBtn("System", "nav:/help system"),
	}
	card := core.NewCard().ButtonsEqual(buttons...).Build()
	got := decodeRenderedCard(t, card)

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one element", got["elements"])
	}
	columnSet, ok := elements[0].(map[string]any)
	if !ok {
		t.Fatalf("first element = %#v, want object", elements[0])
	}
	if tag := columnSet["tag"]; tag != "column_set" {
		t.Fatalf("tag = %#v, want column_set", tag)
	}
	columns, ok := columnSet["columns"].([]any)
	if !ok || len(columns) != len(buttons) {
		t.Fatalf("columns = %#v, want %d columns", columnSet["columns"], len(buttons))
	}

	for i, want := range buttons {
		col, ok := columns[i].(map[string]any)
		if !ok {
			t.Fatalf("column %d = %#v, want object", i, columns[i])
		}
		if width := col["width"]; width != "weighted" {
			t.Fatalf("column %d width = %#v, want weighted", i, width)
		}
		if weight := col["weight"]; weight != float64(1) {
			t.Fatalf("column %d weight = %#v, want 1", i, weight)
		}
		innerElems, ok := col["elements"].([]any)
		if !ok || len(innerElems) != 1 {
			t.Fatalf("column %d elements = %#v, want one button", i, col["elements"])
		}
		btn, ok := innerElems[0].(map[string]any)
		if !ok {
			t.Fatalf("column %d button = %#v, want object", i, innerElems[0])
		}
		if tag := btn["tag"]; tag != "button" {
			t.Fatalf("column %d tag = %#v, want button", i, tag)
		}
		text, ok := btn["text"].(map[string]any)
		if !ok || text["content"] != want.Text {
			t.Fatalf("column %d text = %#v, want %q", i, btn["text"], want.Text)
		}
		if btnType := btn["type"]; btnType != want.Type {
			t.Fatalf("column %d type = %#v, want %q", i, btnType, want.Type)
		}
		value, ok := btn["value"].(map[string]any)
		if !ok || value["action"] != want.Value {
			t.Fatalf("column %d value = %#v, want %q", i, btn["value"], want.Value)
		}
	}
}

func TestRenderCardMap_TwoEqualColumnsUseBisectAndCenteredButtons(t *testing.T) {
	buttons := []core.CardButton{
		core.PrimaryBtn("Session Management", "nav:/help session"),
		core.DefaultBtn("Agent Configuration", "nav:/help agent"),
	}
	card := core.NewCard().ButtonsEqual(buttons...).Build()
	got := decodeRenderedCard(t, card)

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one element", got["elements"])
	}
	columnSet, ok := elements[0].(map[string]any)
	if !ok {
		t.Fatalf("first element = %#v, want object", elements[0])
	}
	if flexMode := columnSet["flex_mode"]; flexMode != "bisect" {
		t.Fatalf("flex_mode = %#v, want bisect", flexMode)
	}
	columns, ok := columnSet["columns"].([]any)
	if !ok || len(columns) != len(buttons) {
		t.Fatalf("columns = %#v, want %d columns", columnSet["columns"], len(buttons))
	}
	for i := range buttons {
		col, ok := columns[i].(map[string]any)
		if !ok {
			t.Fatalf("column %d = %#v, want object", i, columns[i])
		}
		if align := col["horizontal_align"]; align != "center" {
			t.Fatalf("column %d horizontal_align = %#v, want center", i, align)
		}
		innerElems, ok := col["elements"].([]any)
		if !ok || len(innerElems) != 1 {
			t.Fatalf("column %d elements = %#v, want one button", i, col["elements"])
		}
		btn, ok := innerElems[0].(map[string]any)
		if !ok {
			t.Fatalf("column %d button = %#v, want object", i, innerElems[0])
		}
		if width := btn["width"]; width != "fill" {
			t.Fatalf("column %d button width = %#v, want fill", i, width)
		}
	}
}

func TestBuildDecisionCardSplitsManyActionsIntoRows(t *testing.T) {
	dec := core.Decision{
		ID:          "dec_123",
		Title:       "六选项验证",
		Message:     "验证去重。",
		Choices:     []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
		Recommended: "continue",
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one form", got["elements"])
	}
	form, ok := elements[0].(map[string]any)
	if !ok || form["tag"] != "form" {
		t.Fatalf("first element = %#v, want form", elements[0])
	}
	formElements, ok := form["elements"].([]any)
	if !ok {
		t.Fatalf("form elements = %#v, want array", form["elements"])
	}

	var columnSets []map[string]any
	for _, elem := range formElements {
		m, ok := elem.(map[string]any)
		if ok && m["tag"] == "column_set" {
			columnSets = append(columnSets, m)
		}
	}
	if len(columnSets) != 2 {
		t.Fatalf("column sets = %d, want 2", len(columnSets))
	}
	for i, set := range columnSets {
		columns, ok := set["columns"].([]any)
		if !ok || len(columns) != 3 {
			t.Fatalf("row %d columns = %#v, want 3 columns", i, set["columns"])
		}
	}
}

func TestBuildDecisionCardFormatsAutomationMessageIntoReadableLines(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_automation",
		Title:   "Codex线程疑似中断：整理项目进度",
		Message: "线程： 整理项目进度 （019ec912-3a2d-7472-ba84-964e136b5acb） `n判断类型： 疑似中断 / systemError `n最近进展： 12:01 巡检时仍为 active，12:15 巡检时状态变为 systemError；线程工作区为 F:\\development\\acs。 `n需要用户决策： 是否请求目标线程重连/唤醒，继续整理项目进度情况。 `n建议动作： reconnect，要求目标线程恢复后先报告当前阶段、已完成项、未完成项、是否有未提交变更和下一步。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	content := strings.Join(markdownContents, "\n")
	for _, want := range []string{
		"**线程：** 整理项目进度",
		"\n**判断类型：** 疑似中断 / systemError",
		"\n**最近进展：** 12:01 巡检时仍为 active",
		"\n**需要用户决策：** 是否请求目标线程重连/唤醒",
		"\n**建议动作：** reconnect",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("formatted decision message missing %q: %q", want, content)
		}
	}
	if strings.Contains(content, "`n") {
		t.Fatalf("formatted decision message should normalize literal backtick-newline markers: %q", content)
	}
}

func TestBuildDecisionCardFormatsWatchdogMessageFieldsAsSeparateMarkdownElements(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_watchdog",
		Title:   "Codex 巡检：整理项目进度疑似卡点",
		Message: "线程标题： 整理项目进度 `n判断类型： 疑似卡点 `n最近进展： 阶段 6-7 收口切片已修改 checker、文档和测试，并通过最小验证及全局阶段门禁；最后输出停在清理 .tmp 临时目录前后。 `n需要用户决策的问题： 该线程连续两轮巡检没有有效新输出，可能仍在执行清理/提交前复核，也可能卡在长任务或终端无输出。 `n建议动作： 选择 continue 让目标线程按当前方案继续并汇报状态；如怀疑执行中断可选 reconnect。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	wantContents := []string{
		"**线程标题：** 整理项目进度",
		"**判断类型：** 疑似卡点",
		"**最近进展：** 阶段 6-7 收口切片已修改 checker",
		"**需要用户决策的问题：** 该线程连续两轮巡检没有有效新输出",
		"**建议动作：** 选择 continue 让目标线程按当前方案继续并汇报状态",
	}
	if len(markdownContents) != len(wantContents) {
		t.Fatalf("markdown element count = %d, want %d: %#v", len(markdownContents), len(wantContents), markdownContents)
	}
	for i, want := range wantContents {
		if !strings.Contains(markdownContents[i], want) {
			t.Fatalf("markdown element %d = %q, want to contain %q", i, markdownContents[i], want)
		}
		if strings.Contains(markdownContents[i], "`n") {
			t.Fatalf("markdown element %d still contains literal backtick newline: %q", i, markdownContents[i])
		}
	}
}

func TestBuildDecisionCardFormatsNaturalDecisionMessageIntoReadableLines(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_natural",
		Title:   "Codex 巡检待决策：IDSS 生产/主线对齐风险",
		Message: "目标线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5 在 08:16 复核仍显示 origin/main 与主仓 dirty/stale 未变化：dirty_count=311、本地 main 落后 86、生产对齐风险未确认解除。建议选择 continue 让目标线程继续按只读治理巡检/证据路线推进；不要执行生产、远端、主干写入或发布动作。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	wantContents := []string{
		"**线程：** 019f01ce-d4d3-7312-a726-c234bfb5a4f5",
		"**最近进展：** 在 08:16 复核仍显示 origin/main 与主仓 dirty/stale 未变化：dirty_count=311、本地 main 落后 86、生产对齐风险未确认解除。",
		"**建议动作：** 选择 continue 让目标线程继续按只读治理巡检/证据路线推进",
		"**注意事项：** 不要执行生产、远端、主干写入或发布动作。",
	}
	if len(markdownContents) != len(wantContents) {
		t.Fatalf("markdown element count = %d, want %d: %#v", len(markdownContents), len(wantContents), markdownContents)
	}
	for i, want := range wantContents {
		if markdownContents[i] != want {
			t.Fatalf("markdown content %d = %q, want %q", i, markdownContents[i], want)
		}
	}
}

func TestBuildDecisionCardFormatsRealNaturalDecisionMessageIntoReadableLines(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_real_natural",
		Title:   "Codex 巡检：线程 019f01ce 出现 systemError",
		Message: "线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted。最后进展仍是授权执行中的本地治理复审，无 waitingOnApproval；按规则不自动继续或重连，建议选择 continue 或 reconnect。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	wantContents := []string{
		"**线程：** 019f01ce-d4d3-7312-a726-c234bfb5a4f5",
		"**最近进展：** （IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted。最后进展仍是授权执行中的本地治理复审，无 waitingOnApproval；按规则不自动继续或重连，",
		"**建议动作：** 选择 continue 或 reconnect。",
	}
	if len(markdownContents) != len(wantContents) {
		t.Fatalf("markdown element count = %d, want %d: %#v", len(markdownContents), len(wantContents), markdownContents)
	}
	for i, want := range wantContents {
		if markdownContents[i] != want {
			t.Fatalf("markdown content %d = %q, want %q", i, markdownContents[i], want)
		}
	}
}

func TestBuildDecisionCardFormatsRealThreadTitleWithParentheses(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_real_thread_title",
		Title:   "Codex 巡检：线程 019f01ce 出现 systemError",
		Message: "线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted。建议选择 continue 或 reconnect。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	if len(markdownContents) != 3 {
		t.Fatalf("markdown element count = %d, want 3: %#v", len(markdownContents), markdownContents)
	}
	if markdownContents[0] != "**线程：** 019f01ce-d4d3-7312-a726-c234bfb5a4f5" {
		t.Fatalf("thread markdown = %q, want pure uuid", markdownContents[0])
	}
	if !strings.Contains(markdownContents[1], "（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted。") {
		t.Fatalf("detail markdown missing parenthesized title: %q", markdownContents[1])
	}
	if markdownContents[2] != "**建议动作：** 选择 continue 或 reconnect。" {
		t.Fatalf("suggestion markdown = %q, want suggestion line", markdownContents[2])
	}
}

func TestBuildDecisionCardFormatsSemicolonSuggestionVariant(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_semicolon_natural",
		Title:   "Codex 巡检待决策：IDSS 生产/主线对齐风险",
		Message: "线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted；建议选择 continue 或 reconnect。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	if len(markdownContents) != 3 {
		t.Fatalf("markdown element count = %d, want 3: %#v", len(markdownContents), markdownContents)
	}
	if markdownContents[2] != "**建议动作：** 选择 continue 或 reconnect。" {
		t.Fatalf("semicolon variant suggestion markdown = %q, want suggestion line", markdownContents[2])
	}
}

func TestBuildDecisionCardFormatsRecommendationMarkerVariants(t *testing.T) {
	tests := []struct {
		name    string
		message string
	}{
		{
			name:    "comma recommendation",
			message: "线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted，推荐选择 continue 或 reconnect。",
		},
		{
			name:    "semicolon recommendation",
			message: "线程 019f01ce-d4d3-7312-a726-c234bfb5a4f5（IDSS 最高等级发版门禁专家组复审）从正常执行刷新为 systemError / interrupted；推荐选择 continue 或 reconnect。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dec := core.Decision{
				ID:      "dec_recommendation_variant",
				Title:   "Codex 巡检待决策：推荐动作验证",
				Message: tt.message,
				Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
			}
			got := decodeRenderedCard(t, buildDecisionCard(dec))
			markdownContents := decisionCardMarkdownContents(t, got)
			if len(markdownContents) != 3 {
				t.Fatalf("markdown element count = %d, want 3: %#v", len(markdownContents), markdownContents)
			}
			if markdownContents[2] != "**建议动作：** 选择 continue 或 reconnect。" {
				t.Fatalf("recommendation variant suggestion markdown = %q, want suggestion line", markdownContents[2])
			}
		})
	}
}

func TestBuildDecisionCardPreservesMojibakeInputWithoutGuessing(t *testing.T) {
	title := "Codex 鏍煎紡楠岃瘉锛氶€楀彿寤鸿涓庣嚎绋嬫爣棰? `\n  --message"
	message := "绾跨▼ 019f01ce-d4d3-7312-a726-c234bfb5a4f5锛圛DSS 鏈€楂樼瓑绾у彂鐗堥棬绂佷笓瀹剁粍澶嶅锛変粠姝ｅ父鎵ц鍒锋柊涓?systemError / interrupted銆傛渶鍚庤繘灞曚粛鏄巿鏉冩墽琛屼腑鐨勬湰鍦版不鐞嗗瀹★紝鏃?waitingOnApproval锛涙寜瑙勫垯涓嶈嚜鍔ㄧ户缁垨閲嶈繛锛屽缓璁€夋嫨 continue 鎴?reconnect銆?"
	dec := core.Decision{
		ID:      "dec_mojibake_boundary",
		Title:   title,
		Message: message,
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	header := got["header"].(map[string]any)
	headerTitle := header["title"].(map[string]any)
	if headerTitle["content"] != title {
		t.Fatalf("title = %q, want original mojibake input", headerTitle["content"])
	}
	markdownContents := decisionCardMarkdownContents(t, got)
	if len(markdownContents) != 1 || markdownContents[0] != message {
		t.Fatalf("markdown contents = %#v, want original mojibake message", markdownContents)
	}
}

func TestBuildDecisionCardFormatsOwnerDecisionPromptLikeLabeledCard(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_owner",
		Title:   "Codex 巡检：IDSS dirty-main sequence-5 owner decision",
		Message: "线程 019f02ef 仍需要 owner 二选一裁决后才可触碰主 checkout。推荐 continue 后回复推荐 token：APPROVE-IDSS-CURRENT-311-POST-YUNWMS-EVIDENCE-KEEP-HEAD-DISCARD-DIRTY-2-PATHS；备注为 STAGE-WORKTREE-2-PATHS。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	wantContents := []string{
		"**线程：** 019f02ef",
		"**需要用户决策：** 仍需要 owner 二选一裁决后才可触碰主 checkout。",
		"**建议动作：** continue 后回复推荐 token：APPROVE-IDSS-CURRENT-311-POST-YUNWMS-EVIDENCE-KEEP-HEAD-DISCARD-DIRTY-2-PATHS",
		"**备注：** STAGE-WORKTREE-2-PATHS。",
	}
	if len(markdownContents) != len(wantContents) {
		t.Fatalf("markdown element count = %d, want %d: %#v", len(markdownContents), len(wantContents), markdownContents)
	}
	for i, want := range wantContents {
		if markdownContents[i] != want {
			t.Fatalf("markdown content %d = %q, want %q", i, markdownContents[i], want)
		}
	}
}

func TestBuildDecisionCardFormatsLegacyNaturalDecisionMessageIntoReadableLines(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_legacy_natural",
		Title:   "Codex巡检：补货发布需要生产脚本版本边界审批",
		Message: "线程 019f03d9 已到明确阻塞点：release candidate 本地门禁通过、生产只读基线稳定，但继续 DryRun/正式发布前需要你明确批准 scripts/prod_one_click_deploy.ps1 中 2.1.32 -> 2.1.39 的版本常量 bump。建议 continue 表示批准目标线程按当前方案继续；pause 暂停；revise 输入调整指令；ignore/remind_later 冷却；reconnect 仅唤醒汇报。",
		Choices: []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var markdownContents []string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			content, _ := elem["content"].(string)
			markdownContents = append(markdownContents, content)
		}
	}
	wantContents := []string{
		"**线程：** 019f03d9",
		"**最近进展：** 已到明确阻塞点：release candidate 本地门禁通过、生产只读基线稳定，但继续 DryRun/正式发布前需要你明确批准 scripts/prod_one_click_deploy.ps1 中 2.1.32 -> 2.1.39 的版本常量 bump。",
		"**建议动作：** continue 表示批准目标线程按当前方案继续",
		"**其他选项：** pause 暂停；revise 输入调整指令；ignore/remind_later 冷却；reconnect 仅唤醒汇报。",
	}
	if len(markdownContents) != len(wantContents) {
		t.Fatalf("markdown element count = %d, want %d: %#v", len(markdownContents), len(wantContents), markdownContents)
	}
	for i, want := range wantContents {
		if markdownContents[i] != want {
			t.Fatalf("markdown content %d = %q, want %q", i, markdownContents[i], want)
		}
	}
}

func TestBuildDecisionCardDoesNotTreatWindowsPathBackslashNAsNewline(t *testing.T) {
	dec := core.Decision{
		ID:      "dec_path",
		Title:   "路径保护",
		Message: `线程标题： 检查路径 最近进展： 工作区在 C:\new\cc-connect，日志正常。 建议动作： continue`,
		Choices: []string{"continue"},
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))

	elements := got["elements"].([]any)
	form := elements[0].(map[string]any)
	formElements := form["elements"].([]any)
	var content string
	for _, raw := range formElements {
		elem, ok := raw.(map[string]any)
		if ok && elem["tag"] == "markdown" {
			part, _ := elem["content"].(string)
			content += part + "\n"
		}
	}
	if !strings.Contains(content, `C:\new\cc-connect`) {
		t.Fatalf("windows path should keep literal backslash-n segment, got %q", content)
	}
	if strings.Contains(content, "C:\new") {
		t.Fatalf("test fixture should use a literal backslash-n path, got actual newline in %q", content)
	}
}

func TestBuildDecisionCardLocalizesKnownChoiceLabels(t *testing.T) {
	dec := core.Decision{
		ID:          "dec_123",
		Title:       "巡检通知验证",
		Message:     "验证按钮展示。",
		Choices:     []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect", "stop", "abort", "approve"},
		Recommended: "continue",
	}
	got := decodeRenderedCard(t, buildDecisionCard(dec))
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal rendered card failed: %v", err)
	}
	s := string(raw)

	wantLabels := []string{"继续", "暂停", "修改", "忽略", "稍后提醒", "重连", "停止", "停止", "同意"}
	wantChoices := []string{"continue", "pause", "revise", "ignore", "remind_later", "reconnect", "stop", "abort", "approve"}
	buttons := decisionCardButtons(t, got)
	if len(buttons) != len(wantChoices) {
		t.Fatalf("decision buttons = %d, want %d: %#v", len(buttons), len(wantChoices), buttons)
	}
	for i, button := range buttons {
		text, ok := button["text"].(map[string]any)
		if !ok || text["content"] != wantLabels[i] {
			t.Fatalf("button %d text = %#v, want %q", i, button["text"], wantLabels[i])
		}
		value, ok := button["value"].(map[string]any)
		if !ok || value["action"] != "decision:respond" || value["decision_choice"] != wantChoices[i] || value["decision_id"] != "dec_123" {
			t.Fatalf("button %d value = %#v, want decision payload for %q", i, button["value"], wantChoices[i])
		}
	}
	if !strings.Contains(s, `"name":"decision_submit_v1_6465635f313233_636f6e74696e7565"`) {
		t.Fatalf("decision submit name should include payload fallback, got %s", s)
	}
	if !strings.Contains(s, `"name":"decision_submit_v1_6465635f313233_72656d696e645f6c61746572"`) {
		t.Fatalf("decision submit name should preserve underscore choices, got %s", s)
	}
	if strings.Contains(s, `"content":"Optional comment"`) {
		t.Fatalf("decision comment placeholder should be localized, got %s", s)
	}
	if !strings.Contains(s, `"content":"可选备注"`) {
		t.Fatalf("localized comment placeholder missing from rendered decision card: %s", s)
	}
}

func TestDecisionChoiceLabelLocalizesCommonEnglishChoices(t *testing.T) {
	tests := map[string]string{
		"approve":  "同意",
		"accept":   "同意",
		"allow":    "同意",
		"yes":      "同意",
		"confirm":  "同意",
		"proceed":  "同意",
		"reject":   "拒绝",
		"decline":  "拒绝",
		"deny":     "拒绝",
		"no":       "拒绝",
		"cancel":   "取消",
		"retry":    "重试",
		"skip":     "跳过",
		"done":     "完成",
		"complete": "完成",
	}
	for choice, want := range tests {
		if got := decisionChoiceLabel(choice); got != want {
			t.Fatalf("decisionChoiceLabel(%q) = %q, want %q", choice, got, want)
		}
	}
}

func TestRenderCardMap_DefaultActionsStayActionRow(t *testing.T) {
	buttons := []core.CardButton{
		core.PrimaryBtn("Yes", "act:/yes"),
		core.DefaultBtn("No", "act:/no"),
	}
	card := core.NewCard().Buttons(buttons...).Build()
	got := decodeRenderedCard(t, card)

	elements, ok := got["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("elements = %#v, want one element", got["elements"])
	}
	actionRow, ok := elements[0].(map[string]any)
	if !ok {
		t.Fatalf("first element = %#v, want object", elements[0])
	}
	if tag := actionRow["tag"]; tag != "action" {
		t.Fatalf("tag = %#v, want action", tag)
	}
	actions, ok := actionRow["actions"].([]any)
	if !ok || len(actions) != len(buttons) {
		t.Fatalf("actions = %#v, want %d buttons", actionRow["actions"], len(buttons))
	}
	for i, want := range buttons {
		btn, ok := actions[i].(map[string]any)
		if !ok {
			t.Fatalf("button %d = %#v, want object", i, actions[i])
		}
		if tag := btn["tag"]; tag != "button" {
			t.Fatalf("button %d tag = %#v, want button", i, tag)
		}
		text, ok := btn["text"].(map[string]any)
		if !ok || text["content"] != want.Text {
			t.Fatalf("button %d text = %#v, want %q", i, btn["text"], want.Text)
		}
		if btnType := btn["type"]; btnType != want.Type {
			t.Fatalf("button %d type = %#v, want %q", i, btnType, want.Type)
		}
		value, ok := btn["value"].(map[string]any)
		if !ok || value["action"] != want.Value {
			t.Fatalf("button %d value = %#v, want %q", i, btn["value"], want.Value)
		}
	}
}

func TestRenderCardMap_DeleteModeUsesCheckerForm(t *testing.T) {
	card := core.NewCard().
		Title("删除会话", "carmine").
		ListItemBtn("☑ **1.** One · **10** msgs · 03-13 20:00", "已选择", "primary", "act:/delete-mode toggle session-1").
		ListItemBtn("▶ **2.** Active · **30** msgs · 03-13 20:01", "当前会话", "primary", "act:/delete-mode noop session-2").
		ListItemBtn("◻ **3.** Three · **20** msgs · 03-13 20:02", "选择", "default", "act:/delete-mode toggle session-3").
		Note("2 selected").
		Buttons(
			core.DangerBtn("删除已选", "act:/delete-mode confirm"),
			core.DefaultBtn("取消", "act:/delete-mode cancel"),
		).
		Buttons(core.DefaultBtn("下一页 →", "act:/delete-mode page 2")).
		Build()

	got := decodeRenderedCard(t, card)
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal rendered card failed: %v", err)
	}
	s := string(raw)
	if !strings.Contains(s, `"tag":"form"`) || !strings.Contains(s, `"tag":"checker"`) {
		t.Fatalf("expected form+checker rendering, got %s", s)
	}
	if got := strings.Count(s, `"tag":"checker"`); got != 2 {
		t.Fatalf("checker count = %d, want 2, got %s", got, s)
	}
	if !strings.Contains(s, deleteModeCheckerName("session-1")) {
		t.Fatalf("selectable session checker missing, got %s", s)
	}
	if strings.Contains(s, deleteModeCheckerName("session-2")) {
		t.Fatalf("active session should not render checker, got %s", s)
	}
	if !strings.Contains(s, deleteModeCheckerName("session-3")) {
		t.Fatalf("second selectable session checker missing, got %s", s)
	}
	activeIdx := strings.Index(s, `▶ **2.** Active`)
	firstIdx := strings.Index(s, deleteModeCheckerName("session-1"))
	thirdIdx := strings.Index(s, deleteModeCheckerName("session-3"))
	if activeIdx < 0 || firstIdx < 0 || thirdIdx < 0 {
		t.Fatalf("missing expected order markers in rendered card: %s", s)
	}
	if !(firstIdx < activeIdx && activeIdx < thirdIdx) {
		t.Fatalf("row order changed unexpectedly, got %s", s)
	}
	if !strings.Contains(s, `"name":"delete_mode_form"`) {
		t.Fatalf("expected form name for feishu validation, got %s", s)
	}
	if !strings.Contains(s, `"name":"delete_mode_submit"`) || !strings.Contains(s, `"name":"delete_mode_cancel"`) {
		t.Fatalf("expected button names inside form, got %s", s)
	}
	if !strings.Contains(s, `"form_action_type":"submit"`) || !strings.Contains(s, `act:/delete-mode form-submit`) {
		t.Fatalf("expected form submit action, got %s", s)
	}
	if strings.Contains(s, `act:/delete-mode toggle`) {
		t.Fatalf("expected no toggle buttons in rendered card, got %s", s)
	}
}

func TestRenderCardMap_InjectsSessionKeyIntoCallbacks(t *testing.T) {
	card := core.NewCard().
		Buttons(core.PrimaryBtn("Open", "nav:/help session")).
		ListItem("Choose", "Confirm", "act:/confirm").
		Select("Pick one", []core.CardSelectOption{{Text: "A", Value: "askq:0:1"}}, "").
		Build()

	got := renderCardMap(card, "feishu:oc_chat:root:om_root")
	elements, ok := got["elements"].([]map[string]any)
	if !ok || len(elements) != 3 {
		t.Fatalf("elements = %#v, want 3 elements", got["elements"])
	}

	actionRow := elements[0]
	actions := actionRow["actions"].([]map[string]any)
	firstButton := actions[0]
	value := firstButton["value"].(map[string]string)
	if value["session_key"] != "feishu:oc_chat:root:om_root" {
		t.Fatalf("button session_key = %#v, want thread session key", value["session_key"])
	}

	listRow := elements[1]
	columns := listRow["columns"].([]map[string]any)
	actionCol := columns[1]
	listBtn := actionCol["elements"].([]map[string]any)[0]
	listValue := listBtn["value"].(map[string]string)
	if listValue["session_key"] != "feishu:oc_chat:root:om_root" {
		t.Fatalf("list item session_key = %#v, want thread session key", listValue["session_key"])
	}

	selectRow := elements[2]
	selectActions := selectRow["actions"].([]map[string]any)
	selectValue := selectActions[0]["value"].(map[string]string)
	if selectValue["session_key"] != "feishu:oc_chat:root:om_root" {
		t.Fatalf("select session_key = %#v, want thread session key", selectValue["session_key"])
	}
}

func TestBuildCardJSONWithStatusFooter(t *testing.T) {
	body := "Hello world"
	footer := "Opus 4.7 · ↑ 1 ↓ 168 · 4%\n~/path/to/ws"
	jsonStr := buildCardJSONWithStatusFooter(body, footer)

	var card map[string]any
	if err := json.Unmarshal([]byte(jsonStr), &card); err != nil {
		t.Fatalf("decode card json: %v", err)
	}
	body0 := card["body"].(map[string]any)
	elements := body0["elements"].([]any)
	if len(elements) != 3 {
		t.Fatalf("expected 3 elements (body markdown, hr, footer markdown), got %d: %#v", len(elements), elements)
	}
	bodyEl := elements[0].(map[string]any)
	if bodyEl["tag"] != "markdown" || bodyEl["content"] != body {
		t.Errorf("body element = %#v, want markdown with content %q", bodyEl, body)
	}
	hrEl := elements[1].(map[string]any)
	if hrEl["tag"] != "hr" {
		t.Errorf("middle element = %#v, want hr", hrEl)
	}
	footerEl := elements[2].(map[string]any)
	if footerEl["tag"] != "markdown" {
		t.Errorf("footer tag = %v, want markdown", footerEl["tag"])
	}
	if footerEl["text_size"] != "notation" {
		t.Errorf("footer text_size = %v, want \"notation\"", footerEl["text_size"])
	}
	if footerEl["content"] != footer {
		t.Errorf("footer content = %q, want %q", footerEl["content"], footer)
	}
}

func TestBuildCardJSONWithStatusFooter_EmptyFooterFallsThrough(t *testing.T) {
	body := "Hello"
	a := buildCardJSONWithStatusFooter(body, "")
	b := buildCardJSON(body)
	if a != b {
		t.Errorf("empty footer should match buildCardJSON output\n got: %s\nwant: %s", a, b)
	}
	// whitespace-only footer also falls through
	if got := buildCardJSONWithStatusFooter(body, "   \n  "); got != b {
		t.Errorf("whitespace footer should fall through to buildCardJSON")
	}
}
