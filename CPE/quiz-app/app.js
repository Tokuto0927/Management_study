const state = {
  allQuestions: [],
  questions: [],
  current: 0,
  score: 0,
  mistakes: [],
  previousMistakes: [],
  answered: false,
  settings: null,
};

const $ = (id) => document.getElementById(id);
const screens = [$("start-screen"), $("quiz-screen"), $("result-screen")];

function showScreen(target) {
  screens.forEach((screen) => screen.classList.toggle("hidden", screen !== target));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function parseQuestions(markdown) {
  const chapterByNumber = new Map();
  let chapter = 0;
  for (const line of markdown.split("\n")) {
    const chapterMatch = line.match(/^## (?:追加問題（)?第([1-5])章/);
    if (chapterMatch) chapter = Number(chapterMatch[1]);
    const questionMatch = line.match(/^### 問(\d+)(（複数選択）)?/);
    if (questionMatch) chapterByNumber.set(Number(questionMatch[1]), chapter);
  }

  return [...markdown.matchAll(/^### 問(\d+)(（複数選択）)?\n([\s\S]*?)(?=\n### 問|\n## |(?![\s\S]))/gm)].map((match) => {
    const number = Number(match[1]);
    const lines = match[3].trim().split("\n");
    const options = lines
      .filter((line) => /^- [A-D]\. /.test(line))
      .map((line) => ({ key: line[2], text: line.slice(5) }));
    const text = lines.filter((line) => !/^- [A-D]\. /.test(line)).join(" ").trim();
    return { number, chapter: chapterByNumber.get(number), multiple: Boolean(match[2]), text, options };
  });
}

function parseAnswers(markdown) {
  const answers = new Map();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    for (let i = 0; i < cells.length - 1; i += 2) {
      if (/^\d+$/.test(cells[i]) && /^[A-D](?:・[A-D])*$/.test(cells[i + 1])) {
        answers.set(Number(cells[i]), cells[i + 1].split("・"));
      }
    }
  }

  const explanations = new Map();
  for (const match of markdown.matchAll(/^(\d+)\. \*\*([A-D](?:・[A-D])*)\*\*：(.*)$/gm)) {
    explanations.set(Number(match[1]), match[3].trim());
  }
  return { answers, explanations };
}

async function loadQuiz() {
  const [questionResponse, answerResponse, advancedQuestionResponse, advancedAnswerResponse] = await Promise.all([
    fetch("../CPE模擬問題集.md"),
    fetch("../CPE模擬問題集_解答解説.md"),
    fetch("../CPE模擬問題集_上級編.md"),
    fetch("../CPE模擬問題集_上級編_解答解説.md"),
  ]);
  if ([questionResponse, answerResponse, advancedQuestionResponse, advancedAnswerResponse].some((response) => !response.ok)) {
    throw new Error("問題ファイルを読み込めませんでした。");
  }

  const buildBank = (questions, parsedAnswers, bank) => questions.map((question) => ({
    ...question,
    bank,
    answer: parsedAnswers.answers.get(question.number),
    explanation: parsedAnswers.explanations.get(question.number),
  }));
  const standardQuestions = parseQuestions(await questionResponse.text());
  const standardAnswers = parseAnswers(await answerResponse.text());
  const advancedQuestions = parseQuestions(await advancedQuestionResponse.text());
  const advancedAnswers = parseAnswers(await advancedAnswerResponse.text());
  state.allQuestions = [
    ...buildBank(standardQuestions, standardAnswers, "standard"),
    ...buildBank(advancedQuestions, advancedAnswers, "advanced"),
  ];
  if (state.allQuestions.length !== 150 || state.allQuestions.some((q) => !q.answer || !q.explanation || q.options.length !== 4)) {
    throw new Error("問題・解答・解説の対応に不整合があります。");
  }
  $("load-status").textContent = "標準100問・上級50問を読み込みました。";
  $("start-button").disabled = false;
}

function beginQuiz(customQuestions = null) {
  const bank = $("bank-select").value;
  const chapter = $("chapter-select").value;
  const requested = Number($("count-select").value);
  const randomize = $("shuffle-check").checked;
  let pool = customQuestions || state.allQuestions.filter((q) =>
    q.bank === bank && (chapter === "all" || q.chapter === Number(chapter))
  );
  if (randomize) pool = shuffle(pool);
  const count = Math.min(requested, pool.length);
  state.questions = pool.slice(0, count);
  state.current = 0;
  state.score = 0;
  state.mistakes = [];
  state.answered = false;
  state.settings = { bank, chapter, requested, randomize };
  showScreen($("quiz-screen"));
  renderQuestion();
}

function renderQuestion() {
  const question = state.questions[state.current];
  state.answered = false;
  $("question-counter").textContent = `${state.current + 1} / ${state.questions.length}`;
  $("score-counter").textContent = `正解 ${state.score}`;
  $("progress-bar").style.width = `${(state.current / state.questions.length) * 100}%`;
  $("question-type").textContent = question.multiple ? "複数選択・すべて選択" : "単一選択";
  $("question-text").textContent = `問${question.number}　${question.text}`;
  const optionsContainer = $("options");
  optionsContainer.replaceChildren();
  question.options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "option";
    label.dataset.key = option.key;
    const input = document.createElement("input");
    input.type = question.multiple ? "checkbox" : "radio";
    input.name = "answer";
    input.value = option.key;
    const text = document.createElement("span");
    text.textContent = `${option.key}. ${option.text}`;
    label.append(input, text);
    optionsContainer.append(label);
  });
  $("answer-button").classList.remove("hidden");
  $("answer-button").disabled = true;
  $("next-button").classList.add("hidden");
  $("feedback").className = "feedback hidden";
  $("options").querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      $("answer-button").disabled = !$("options").querySelector("input:checked");
    });
  });
}

function submitAnswer() {
  if (state.answered) return;
  state.answered = true;
  const question = state.questions[state.current];
  const selected = [...$("options").querySelectorAll("input:checked")].map((input) => input.value).sort();
  const correct = [...question.answer].sort();
  const isCorrect = selected.length === correct.length && selected.every((value, index) => value === correct[index]);
  if (isCorrect) state.score += 1;
  else state.mistakes.push(question);

  $("options").querySelectorAll("input").forEach((input) => { input.disabled = true; });
  $("options").querySelectorAll(".option").forEach((option) => {
    if (correct.includes(option.dataset.key)) option.classList.add("correct-option");
    else if (selected.includes(option.dataset.key)) option.classList.add("wrong-option");
  });

  const feedback = $("feedback");
  feedback.className = `feedback ${isCorrect ? "good" : "bad"}`;
  feedback.innerHTML = `<strong>${isCorrect ? "正解！" : `不正解（正解：${correct.join("・")}）`}</strong>${question.explanation}`;
  $("score-counter").textContent = `正解 ${state.score}`;
  $("answer-button").classList.add("hidden");
  $("next-button").textContent = state.current === state.questions.length - 1 ? "結果を見る" : "次の問題へ";
  $("next-button").classList.remove("hidden");
}

function nextQuestion() {
  if (state.current < state.questions.length - 1) {
    state.current += 1;
    renderQuestion();
  } else {
    showResult();
  }
}

function showResult() {
  state.previousMistakes = [...state.mistakes];
  const total = state.questions.length;
  const rate = Math.round((state.score / total) * 100);
  $("result-score").textContent = `${state.score} / ${total}`;
  $("result-title").textContent = rate >= 80 ? "よく理解できています" : rate >= 60 ? "あと一歩です" : "復習して固めましょう";
  $("result-message").textContent = `正答率は${rate}%、間違いは${state.mistakes.length}問でした。`;
  $("result-mistakes-button").classList.toggle("hidden", state.mistakes.length === 0);
  $("retry-mistakes-button").classList.toggle("hidden", state.mistakes.length === 0);
  showScreen($("result-screen"));
}

$("start-button").disabled = true;
$("start-button").addEventListener("click", () => beginQuiz());
$("answer-button").addEventListener("click", submitAnswer);
$("next-button").addEventListener("click", nextQuestion);
$("result-retry-button").addEventListener("click", () => beginQuiz());
$("result-mistakes-button").addEventListener("click", () => beginQuiz(state.previousMistakes));
$("retry-mistakes-button").addEventListener("click", () => beginQuiz(state.previousMistakes));
$("back-button").addEventListener("click", () => showScreen($("start-screen")));

loadQuiz().catch((error) => {
  $("load-status").textContent = error.message;
});
