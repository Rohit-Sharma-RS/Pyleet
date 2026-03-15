/* ============================================
   PyLeet — Application Logic
   ============================================ */

// --- State ---
let editor = null;
let pyodide = null;
let pyodideReady = false;
let currentProblem = null;
let testCases = [];
let originalCode = "";
let currentGoldenNotes = {}; // lineIndex -> { text, timestamp }

// --- Initialize ---
document.addEventListener("DOMContentLoaded", () => {
  initEditor();
  loadPyodide();
  initAuth(); // Initialize Firebase Auth (loads cloud data & updates history)
  loadHistory();

  // Handle Enter key on URL input
  document.getElementById("urlInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchProblem();
  });
});

// --- CodeMirror Editor ---
function initEditor() {
  editor = CodeMirror.fromTextArea(document.getElementById("codeEditor"), {
    mode: "python",
    theme: "dracula",
    lineNumbers: true,
    gutters: ["CodeMirror-linenumbers", "golden-gutter"],
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    lineWrapping: true,
    viewportMargin: Infinity,
    extraKeys: {
      Tab: (cm) => cm.replaceSelection("    ", "end"),
      "Cmd-Enter": () => runCode(),
      "Ctrl-Enter": () => runCode(),
    },
  });
  
  editor.setValue(
    "# Paste a LeetCode URL above and click Fetch to get started!\n",
  );

  // Handle Golden Gutter Clicks
  editor.on("gutterClick", (cm, line, gutter) => {
    if (gutter === "golden-gutter" || gutter === "CodeMirror-linenumbers") {
      openGoldenNoteModal(line);
    }
  });
}

// --- Pyodide Loading ---
async function loadPyodide() {
  const statusDot = document.querySelector(".status-dot");
  const statusText = document.querySelector(".status-text");

  try {
    // Load Pyodide script dynamically
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js";
    document.head.appendChild(script);

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
    });

    // Initialize Pyodide
    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/",
    });

    pyodideReady = true;
    statusDot.classList.remove("loading");
    statusText.textContent = "Python Ready";
  } catch (err) {
    console.error("Failed to load Pyodide:", err);
    statusDot.classList.remove("loading");
    statusDot.classList.add("error");
    statusText.textContent = "Python Failed";
  }
}

// --- URL Parsing ---
function extractSlug(url) {
  url = url.trim();
  // Handle various LeetCode URL formats
  const patterns = [
    /leetcode\.com\/problems\/([a-z0-9-]+)/i,
    /leetcode\.cn\/problems\/([a-z0-9-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1].toLowerCase().replace(/\/$/, "");
  }
  return null;
}

// --- Fetch Problem ---
async function fetchProblemFromAPI(slug) {
  // Try the Vercel serverless function first
  try {
    const response = await fetch(
      `/api/leetcode?slug=${encodeURIComponent(slug)}`,
    );
    if (response.ok) {
      const data = await response.json();
      if (data && data.title) return data;
    }
  } catch (e) {
    console.log("Vercel API not available, trying direct fetch...");
  }

  // Fallback: direct LeetCode GraphQL via CORS proxies
  const query = `
        query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
                questionId
                title
                titleSlug
                content
                difficulty
                exampleTestcases
                metaData
                codeSnippets {
                    lang
                    langSlug
                    code
                }
            }
        }
    `;

  const corsProxies = [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
  ];

  for (const proxy of corsProxies) {
    try {
      const targetUrl = "https://leetcode.com/graphql/";
      const response = await fetch(proxy + encodeURIComponent(targetUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { titleSlug: slug },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.data?.question?.title) return data.data.question;
      }
    } catch (e) {
      console.log(`CORS proxy ${proxy} failed, trying next...`);
    }
  }

  throw new Error(
    "Could not fetch from LeetCode. Please deploy to Vercel or try again later.",
  );
}

async function fetchProblem() {
  const urlInput = document.getElementById("urlInput");
  const urlError = document.getElementById("urlError");
  const url = urlInput.value.trim();

  urlError.textContent = "";

  if (!url) {
    urlError.textContent = "Please paste a LeetCode problem URL.";
    return;
  }

  const slug = extractSlug(url);
  if (!slug) {
    urlError.textContent =
      "Invalid LeetCode URL. Please use a URL like: https://leetcode.com/problems/two-sum/";
    return;
  }

  showLoading("Fetching problem...");

  try {
    const data = await fetchProblemFromAPI(slug);

    currentProblem = data;
    currentGoldenNotes = {}; // New problem, clear notes until loaded
    
    // Check if we have history for this to load existing notes
    const history = getHistory();
    const existing = history.find(h => h.slug === currentProblem.titleSlug);
    if (existing && existing.goldenNotes) {
      currentGoldenNotes = existing.goldenNotes;
    }

    renderProblem(data);
    setupTestCases(data);
    setupEditor(data);
    
    renderGoldenGutters();
    renderInsightsTab();

    document.getElementById("mainContent").style.display = "block";
    hideLoading();

    // Scroll to content on mobile
    if (window.innerWidth <= 900) {
      document
        .getElementById("mainContent")
        .scrollIntoView({ behavior: "smooth" });
    }
  } catch (err) {
    hideLoading();
    urlError.textContent =
      err.message || "Failed to fetch problem. Please try again.";
    console.error("Fetch error:", err);
  }
}

// --- Render Problem ---
function renderProblem(problem) {
  document.getElementById("problemTitle").textContent =
    `${problem.questionId}. ${problem.title}`;

  const badge = document.getElementById("problemDifficulty");
  badge.textContent = problem.difficulty;
  badge.className = "difficulty-badge " + problem.difficulty.toLowerCase();

  // Render problem description HTML
  const descEl = document.getElementById("problemDescription");
  let content = problem.content || "<p>No description available.</p>";

  // Clean up the HTML content slightly
  content = content.replace(/<p>&nbsp;<\/p>/g, "");

  descEl.innerHTML = content;

  // Show the edit button
  const editDescBtn = document.getElementById("editActiveDescBtn");
  const saveDescBtn = document.getElementById("saveActiveDescBtn");
  const descEditArea = document.getElementById("problemDescriptionEdit");

  if (editDescBtn && saveDescBtn && descEditArea) {
    editDescBtn.style.display = "inline-flex";
    saveDescBtn.style.display = "none";
    descEl.style.display = "block";
    descEditArea.style.display = "none";
  }
}

function editActiveDescription() {
  if (!currentProblem) return;
  const descEl = document.getElementById("problemDescription");
  const editArea = document.getElementById("problemDescriptionEdit");
  
  descEl.style.display = "none";
  editArea.value = currentProblem.content || "";
  editArea.style.display = "block";
  editArea.focus();
  
  document.getElementById("editActiveDescBtn").style.display = "none";
  document.getElementById("saveActiveDescBtn").style.display = "inline-flex";
}

function saveActiveDescription() {
  if (!currentProblem) return;
  const editArea = document.getElementById("problemDescriptionEdit");
  const newDesc = editArea.value;
  
  currentProblem.content = newDesc;
  
  // Update the display
  renderProblem(currentProblem);
  
  // For custom problems, use the dedicated save function
  if (currentProblem.questionId === "Custom") {
    saveCustomProblemToHistory();
    return;
  }
  
  // Update history if this problem is already in history
  const history = getHistory();
  const existingIdx = history.findIndex((h) => h.slug === currentProblem.titleSlug);
  if (existingIdx >= 0) {
    history[existingIdx].description = newDesc;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (typeof debouncedSync === 'function') debouncedSync();
    loadHistory();
  }
}

// --- Parse Test Cases ---
function setupTestCases(problem) {
  testCases = [];

  let metaData = {};
  try {
    metaData = JSON.parse(problem.metaData || "{}");
  } catch (e) {
    console.warn("Failed to parse metaData:", e);
  }

  const params = metaData.params || [];
  const paramCount = params.length;

  // Parse input values from exampleTestcases
  const inputLines = (problem.exampleTestcases || "")
    .split("\n")
    .filter((line) => line.trim() !== "");

  // Parse expected outputs from HTML content
  const expectedOutputs = parseExpectedOutputs(problem.content || "");

  if (paramCount > 0 && inputLines.length >= paramCount) {
    const testCount = Math.floor(inputLines.length / paramCount);
    for (let t = 0; t < testCount; t++) {
      const inputs = {};
      for (let p = 0; p < paramCount; p++) {
        const paramName = params[p].name || `param${p}`;
        inputs[paramName] = inputLines[t * paramCount + p];
      }
      testCases.push({
        inputs,
        expected: t < expectedOutputs.length ? expectedOutputs[t] : null,
      });
    }
  } else if (inputLines.length > 0) {
    // Fallback: treat each line as a single input
    inputLines.forEach((line, i) => {
      testCases.push({
        inputs: { input: line },
        expected: i < expectedOutputs.length ? expectedOutputs[i] : null,
      });
    });
  }

  renderTestCases();
}

function parseExpectedOutputs(htmlContent) {
  const outputs = [];
  // Create a temporary DOM element to parse HTML
  const temp = document.createElement("div");
  temp.innerHTML = htmlContent;

  // Strategy 1: Look for <strong>Output:</strong> followed by text
  const allText = temp.innerHTML;

  // Match patterns like "Output:</strong> value" or "Output: </strong><span>value</span>"
  const patterns = [
    /<strong>Output:<\/strong>\s*(?:<\/p>\s*<pre>)?\s*(.*?)(?:\s*<br|<\/pre>|\n|<strong>Explanation)/gi,
    /<strong>Output:\s*<\/strong>\s*<span[^>]*>(.*?)<\/span>/gi,
    /<strong>Output<\/strong>:\s*(.*?)(?:\s*<br|<\/pre>|\n|<strong>)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(allText)) !== null) {
      let val = match[1].trim();
      // Strip HTML tags
      val = val.replace(/<[^>]*>/g, "").trim();
      if (val) outputs.push(val);
    }
    if (outputs.length > 0) break;
  }

  return outputs;
}

function renderTestCases() {
  const container = document.getElementById("testCasesList");

  if (testCases.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p class="empty-state-text">No test cases available. Click "Add Test Case" to create one.</p>
            </div>`;
    return;
  }

  container.innerHTML = testCases
    .map(
      (tc, i) => `
        <div class="test-case-card">
            <div class="test-case-header-row">
                <div class="test-case-header">Test Case ${i + 1}</div>
                <button class="test-case-delete-btn" onclick="removeTestCase(${i})">✕ Remove</button>
            </div>
            ${Object.entries(tc.inputs)
              .map(
                ([key, val]) => `
                <div class="test-case-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <span class="test-case-label" style="font-size: 0.8rem;">${key}:</span>
                    <textarea class="test-case-input" onchange="updateTestCase(${i}, 'input', '${key}', this.value)">${escapeHtml(val)}</textarea>
                </div>
            `,
              )
              .join("")}
            <div class="test-case-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                <span class="test-case-label" style="font-size: 0.8rem;">Expected Output:</span>
                <textarea class="test-case-input" onchange="updateTestCase(${i}, 'expected', null, this.value)">${escapeHtml(tc.expected || "")}</textarea>
            </div>
        </div>
    `,
    )
    .join("");
}

// --- Editor Setup ---
function setupEditor(problem) {
  const snippets = problem.codeSnippets || [];
  const pythonSnippet =
    snippets.find((s) => s.langSlug === "python3") ||
    snippets.find((s) => s.langSlug === "python");

  if (pythonSnippet) {
    originalCode = pythonSnippet.code;
  } else {
    originalCode =
      "# Python code snippet not available for this problem.\n# Please write your solution here.\n\nclass Solution:\n    pass\n";
  }

  editor.setValue(originalCode);
  editor.refresh();
  
  renderGoldenGutters();
  renderInsightsTab();

  // Focus editor on desktop
  if (window.innerWidth > 900) {
    setTimeout(() => editor.focus(), 100);
  }
}

function resetCode() {
  if (originalCode) {
    editor.setValue(originalCode);
  }
}

// --- Run Code ---
async function runCode() {
  if (!pyodideReady) {
    alert("Python is still loading. Please wait a moment and try again.");
    return;
  }

  if (testCases.length === 0) {
    alert("No test cases available. Please fetch a problem first.");
    return;
  }

  const runBtn = document.getElementById("runBtn");
  runBtn.disabled = true;
  runBtn.querySelector("span").textContent = "Running...";

  // Clear previous error highlights
  clearErrorHighlights();

  const resultsPanel = document.getElementById("resultsPanel");
  const resultsBody = document.getElementById("resultsBody");
  const resultsTitle = document.getElementById("resultsTitle");

  resultsPanel.style.display = "flex";
  resultsBody.innerHTML =
    '<div class="loader-text" style="text-align:center;padding:20px;">Running tests...</div>';

  let metaData = {};
  try {
    metaData = JSON.parse(currentProblem.metaData || "{}");
  } catch (e) {}

  const methodName = metaData.name || "solve";
  const params = metaData.params || [];
  const userCode = editor.getValue();

  let allPassed = true;
  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const result = await runSingleTest(userCode, methodName, params, tc, i);
    results.push(result);
    if (!result.passed) allPassed = false;
  }

  // Render results
  const passCount = results.filter((r) => r.passed).length;

  if (allPassed) {
    resultsTitle.textContent = `✓ All ${results.length} Tests Passed`;
    resultsTitle.className = "results-title pass";
  } else {
    resultsTitle.textContent = `✗ ${passCount}/${results.length} Tests Passed`;
    resultsTitle.className = "results-title fail";
  }

  // Highlight error lines
  const errorResults = results.filter((r) => r.error);
  if (errorResults.length > 0) {
    errorResults.forEach((r) => highlightErrorLine(r.error));
  }

  // Save to history
  saveToHistory(allPassed, passCount, results.length);

  resultsBody.innerHTML = results
    .map((r, i) => {
      if (r.error) {
        return `
                <div class="result-card fail">
                    <div class="result-card-header">
                        <span class="result-icon">✗</span>
                        Test Case ${i + 1} — Error
                    </div>
                    <div class="error-output">${escapeHtml(r.error)}</div>
                </div>`;
      }

      return `
            <div class="result-card ${r.passed ? "pass" : "fail"}">
                <div class="result-card-header">
                    <span class="result-icon">${r.passed ? "✓" : "✗"}</span>
                    Test Case ${i + 1} — ${r.passed ? "Passed" : "Failed"}
                </div>
                <div class="result-details">
                    ${Object.entries(testCases[i].inputs)
                      .map(
                        ([key, val]) => `
                        <div class="detail-row">
                            <span class="detail-label">${key}:</span>
                            <span class="detail-value">${escapeHtml(val)}</span>
                        </div>
                    `,
                      )
                      .join("")}
                    <div class="detail-row">
                        <span class="detail-label">Expected:</span>
                        <span class="detail-value">${escapeHtml(r.expected || "N/A")}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Output:</span>
                        <span class="detail-value">${escapeHtml(r.actual)}</span>
                    </div>
                    ${
                      r.stdout
                        ? `
                        <div class="detail-row">
                            <span class="detail-label">Stdout:</span>
                            <span class="detail-value">${escapeHtml(r.stdout)}</span>
                        </div>
                    `
                        : ""
                    }
                </div>
            </div>`;
    })
    .join("");

  runBtn.disabled = false;
  runBtn.querySelector("span").textContent = "Run";
}

async function runSingleTest(userCode, methodName, params, testCase, index) {
  try {
    // Build the argument list for the method call
    const argValues = Object.values(testCase.inputs);
    const argsStr = argValues
      .map((val) => {
        // Values from LeetCode are already in Python-compatible format
        return val;
      })
      .join(", ");

    // Build the Python test code
    const testCode = `
import sys
import json
from io import StringIO
from typing import List, Optional, Dict, Tuple, Set

# Capture stdout
_captured_stdout = StringIO()
_old_stdout = sys.stdout
sys.stdout = _captured_stdout

# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

# Definition for a binary tree node.
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def _build_tree(lst):
    if not lst or lst[0] is None:
        return None
    root = TreeNode(lst[0])
    queue = [root]
    i = 1
    while queue and i < len(lst):
        node = queue.pop(0)
        if i < len(lst) and lst[i] is not None:
            node.left = TreeNode(lst[i])
            queue.append(node.left)
        i += 1
        if i < len(lst) and lst[i] is not None:
            node.right = TreeNode(lst[i])
            queue.append(node.right)
        i += 1
    return root

def _tree_to_list(root):
    if not root:
        return []
    result = []
    queue = [root]
    while queue:
        node = queue.pop(0)
        if node:
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        else:
            result.append(None)
    while result and result[-1] is None:
        result.pop()
    return result

def _build_linked_list(lst):
    dummy = ListNode(0)
    curr = dummy
    for val in lst:
        curr.next = ListNode(val)
        curr = curr.next
    return dummy.next

def _linked_list_to_list(head):
    result = []
    while head:
        result.append(head.val)
        head = head.next
    return result

# User code
${userCode}

# Run test
try:
    _sol = Solution()
    _result = _sol.${methodName}(${argsStr})

    # Convert special types to serializable format
    if isinstance(_result, ListNode):
        _result = _linked_list_to_list(_result)
    elif isinstance(_result, TreeNode):
        _result = _tree_to_list(_result)

    sys.stdout = _old_stdout
    _stdout_content = _captured_stdout.getvalue()

    # Output as JSON
    import json
    _out = json.dumps({"result": _result, "stdout": _stdout_content})
except Exception as e:
    sys.stdout = _old_stdout
    _stdout_content = _captured_stdout.getvalue()
    _out = json.dumps({"error": str(e), "stdout": _stdout_content})

_out
`;

    const output = await pyodide.runPythonAsync(testCode);
    const parsed = JSON.parse(output);

    if (parsed.error) {
      return {
        passed: false,
        error: parsed.error,
        stdout: parsed.stdout || "",
      };
    }

    // Format the result for comparison
    let actualStr = formatResult(parsed.result);
    let expectedStr = testCase.expected || "";

    // Compare results
    const passed = compareResults(actualStr, expectedStr);

    return {
      passed,
      actual: actualStr,
      expected: expectedStr,
      stdout: parsed.stdout || "",
    };
  } catch (err) {
    return {
      passed: false,
      error: err.message || String(err),
      stdout: "",
    };
  }
}

// --- Result Comparison ---
function formatResult(result) {
  if (result === null || result === undefined) return "null";
  if (typeof result === "boolean") {
    return result ? "true" : "false";
  }
  if (typeof result === "string") return `"${result}"`;
  if (Array.isArray(result)) {
    return "[" + result.map((item) => formatResult(item)).join(",") + "]";
  }
  return String(result);
}

function compareResults(actual, expected) {
  if (!expected) return false;

  // Normalize both strings for comparison
  const normalizeStr = (s) => {
    return s
      .replace(/\s+/g, "")
      .replace(/'/g, '"')
      .replace(/True/gi, "true")
      .replace(/False/gi, "false")
      .replace(/None/gi, "null")
      .toLowerCase();
  };

  const normActual = normalizeStr(actual);
  const normExpected = normalizeStr(expected);

  if (normActual === normExpected) return true;

  // Try parsing as JSON and deep compare
  try {
    const a = JSON.parse(normActual.replace(/'/g, '"'));
    const b = JSON.parse(normExpected.replace(/'/g, '"'));
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {}

  return false;
}

// --- Tab Switching ---
function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === tabName + "Tab");
  });
}

// --- UI Helpers ---
function showLoading(text) {
  document.getElementById("loaderText").textContent = text || "Loading...";
  document.getElementById("loadingOverlay").classList.add("active");
}

function hideLoading() {
  document.getElementById("loadingOverlay").classList.remove("active");
}

function closeResults() {
  document.getElementById("resultsPanel").style.display = "none";
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Error Line Highlighting ---
let errorLineMarkers = [];

function clearErrorHighlights() {
  errorLineMarkers.forEach((line) => {
    editor.removeLineClass(line, "background", "error-line");
    editor.removeLineClass(line, "wrap", "error-line");
  });
  errorLineMarkers = [];
}

function highlightErrorLine(errorMsg) {
  if (!errorMsg || !editor) return;
  // Parse line number from Python traceback, e.g. "line 5"
  // The user code starts at line ~37 in the test script (after all helper code)
  // We look for the LAST "line X" reference which is usually the user's code
  const matches = [...errorMsg.matchAll(/line (\d+)/gi)];
  if (matches.length === 0) return;

  // Take the last match (most likely the user code line)
  const lastMatch = matches[matches.length - 1];
  const errorLine = parseInt(lastMatch[1], 10);

  // The user code is injected into the test script. We need to find the offset.
  // Count lines before "# User code" marker in the test template
  // The template has ~36 lines before user code (imports, helpers, etc.)
  // But the traceback line numbers are absolute in the test script.
  // We need to subtract the header lines count.
  // The header is everything up to and including "# User code"
  const userCodeOffset = 36; // approximate lines of helper code before user code
  const editorLine = errorLine - userCodeOffset - 1; // 0-indexed for CodeMirror

  if (editorLine >= 0 && editorLine < editor.lineCount()) {
    editor.addLineClass(editorLine, "background", "error-line");
    errorLineMarkers.push(editorLine);
    // Scroll to the error line
    editor.scrollIntoView({ line: editorLine, ch: 0 }, 100);
  }
}

// --- History Management (localStorage) ---
const HISTORY_KEY = "pyleet_history";
const FAVORITES_KEY = "pyleet_favorites";
let historyDetailView = false;
let historyFilter = "all"; // 'all' or 'favorites'

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function saveToHistory(allPassed, passCount, totalTests) {
  if (!currentProblem) return;

  const history = getHistory();
  const slug = currentProblem.titleSlug;
  const userCode = editor.getValue();

  // Check if this problem already exists in history
  const existingIdx = history.findIndex((h) => h.slug === slug);

  const entry = {
    slug,
    title: currentProblem.title,
    questionId: currentProblem.questionId,
    difficulty: currentProblem.difficulty,
    status: allPassed ? "solved" : "attempted",
    passCount,
    totalTests,
    lastAttempt: new Date().toISOString(),
    attempts: 1,
    url: currentProblem.questionId === "Custom" ? "" : `https://leetcode.com/problems/${slug}/`,
    code: userCode,
    description: currentProblem.content || "",
    favorite: false,
    isCustom: currentProblem.questionId === "Custom",
    metaData: currentProblem.metaData,
    testCases: currentProblem.questionId === "Custom" ? testCases : undefined,
    goldenNotes: currentGoldenNotes
  };

  if (existingIdx >= 0) {
    entry.attempts = (history[existingIdx].attempts || 1) + 1;
    entry.favorite = history[existingIdx].favorite || false; // preserve favorite
    if (history[existingIdx].status === "solved") {
      entry.status = "solved";
    }
    history[existingIdx] = entry;
  } else {
    history.unshift(entry);
  }

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  debouncedSync(); // Sync to cloud
  loadHistory();
}

function loadHistory() {
  const history = getHistory();
  const countEl = document.getElementById("historyCount");
  const favCountEl = document.getElementById("favoritesCount");
  const listEl = document.getElementById("historyList");
  const statsEl = document.getElementById("historyStats");

  countEl.textContent = history.length;
  const favCount = history.filter((h) => h.favorite).length;
  if (favCountEl) favCountEl.textContent = favCount;

  if (history.length === 0) {
    listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <p class="empty-state-text">No problems practiced yet.<br>Fetch a problem and run your solution!</p>
            </div>`;
    statsEl.innerHTML = "";
    return;
  }

  // Stats
  const solved = history.filter((h) => h.status === "solved").length;
  const attempted = history.length - solved;
  const easy = history.filter((h) => h.difficulty === "Easy").length;
  const medium = history.filter((h) => h.difficulty === "Medium").length;
  const hard = history.filter((h) => h.difficulty === "Hard").length;

  statsEl.innerHTML = `
        <div class="stat-item">
            <span class="stat-value">${history.length}</span>
            <span class="stat-label">Total</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--success)">${solved}</span>
            <span class="stat-label">Solved</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--warning)">${attempted}</span>
            <span class="stat-label">Trying</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--success)">${easy}</span>
            <span class="stat-label">Easy</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--warning)">${medium}</span>
            <span class="stat-label">Med</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--error)">${hard}</span>
            <span class="stat-label">Hard</span>
        </div>
        <div class="stat-item">
            <span class="stat-value" style="color:var(--accent)">★ ${favCount}</span>
            <span class="stat-label">Favs</span>
        </div>`;

  // Filter bar
  const filterHTML = `
        <div class="history-filter-bar">
            <button class="history-filter-btn ${historyFilter === "all" ? "active" : ""}" onclick="setHistoryFilter('all')">
                All (${history.length})
            </button>
            <button class="history-filter-btn ${historyFilter === "favorites" ? "active" : ""}" onclick="setHistoryFilter('favorites')">
                ★ Favorites (${favCount})
            </button>
        </div>`;

  // Sort: most recent first
  let sorted = [...history].sort(
    (a, b) => new Date(b.lastAttempt) - new Date(a.lastAttempt),
  );

  // Apply filter
  if (historyFilter === "favorites") {
    sorted = sorted.filter((h) => h.favorite);
  }

  if (sorted.length === 0) {
    listEl.innerHTML =
      filterHTML +
      `
            <div class="empty-state">
                <div class="empty-state-icon">⭐</div>
                <p class="empty-state-text">No favorite problems yet.<br>Click the star on any problem to favorite it!</p>
            </div>`;
    return;
  }

  let currentGroupDate = null;
  const getGroupDateString = (dateObj) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateObj.toDateString() === today.toDateString()) {
      return "Today";
    } else if (dateObj.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return dateObj.toLocaleDateString(undefined, {
        year: 'numeric', 
        month: 'short', 
        day: 'numeric'
      });
    }
  };

  listEl.innerHTML =
    filterHTML +
    sorted
      .map((item) => {
        const date = new Date(item.lastAttempt);
        const groupDateStr = getGroupDateString(date);
        let headerHtml = "";

        if (groupDateStr !== currentGroupDate) {
          headerHtml = `<div class="history-date-header">${groupDateStr}</div>`;
          currentGroupDate = groupDateStr;
        }

        const timeAgo = getTimeAgo(date);
        const diffClass = item.difficulty.toLowerCase();
        const isFav = item.favorite;

        return `
            ${headerHtml}
            <div class="history-item">
                <div class="history-item-title">
                    <button class="favorite-star ${isFav ? "active" : ""}" onclick="event.stopPropagation(); toggleFavorite('${item.slug}')" title="${isFav ? "Remove from favorites" : "Add to favorites"}">
                        ${isFav ? "★" : "☆"}
                    </button>
                    <span>${item.questionId}. ${escapeHtml(item.title)}</span>
                    <span class="difficulty-badge ${diffClass}" style="font-size:0.65rem;padding:1px 6px;">${item.difficulty}</span>
                    ${item.goldenNotes && Object.keys(item.goldenNotes).length > 0 ? '<span class="history-item-golden-badge" title="Has Golden Insights">✨</span>' : ''}
                </div>
                <div class="history-item-meta">
                    <span class="history-status ${item.status}">
                        ${item.status === "solved" ? "✓ Solved" : "◷ Attempted"}
                    </span>
                    <span>${item.passCount}/${item.totalTests} tests</span>
                    <span>${item.attempts} run${item.attempts > 1 ? "s" : ""}</span>
                    <span>${timeAgo}</span>
                </div>
                <div class="history-item-actions">
                    <button class="history-action-btn view-btn" onclick="viewHistoryDetail('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        View
                    </button>
                    <button class="history-action-btn load-btn" onclick="loadFromHistory('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        Reload
                    </button>
                    <button class="history-action-btn redo-btn" onclick="redoFromHistory('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21.5 2v6h-6"></path><path d="M21.34 15.57a10 10 0 1 1-.57-8.38L21.5 8"></path></svg>
                        Redo
                    </button>
                </div>
            </div>`;
      })
      .join("");
}

function viewHistoryDetail(slug) {
  const history = getHistory();
  const item = history.find((h) => h.slug === slug);
  if (!item) return;

  historyDetailView = true;
  const listEl = document.getElementById("historyList");
  const diffClass = item.difficulty.toLowerCase();
  const date = new Date(item.lastAttempt);
  const isFav = item.favorite;

  listEl.innerHTML = `
        <div class="history-detail">
            <button class="history-back-btn" onclick="backToHistoryList()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
                Back to list
            </button>

            <div class="history-detail-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="favorite-star ${isFav ? "active" : ""}" onclick="toggleFavorite('${item.slug}'); viewHistoryDetail('${item.slug}');" title="${isFav ? "Remove from favorites" : "Add to favorites"}" style="font-size:1.3rem;">
                        ${isFav ? "★" : "☆"}
                    </button>
                    <h3 class="history-detail-title">${item.questionId}. ${escapeHtml(item.title)}</h3>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
                    <span class="difficulty-badge ${diffClass}">${item.difficulty}</span>
                    <span class="history-status ${item.status}">
                        ${item.status === "solved" ? "✓ Solved" : "◷ Attempted"}
                    </span>
                    <span style="font-size:0.75rem;color:var(--text-tertiary)">${item.passCount}/${item.totalTests} tests · ${item.attempts} run${item.attempts > 1 ? "s" : ""} · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
            </div>

            <div class="history-detail-section">
                <h4 class="history-section-label">📝 Your Solution</h4>
                <div class="history-code-block"><pre><code>${escapeHtml(item.code || "No code saved")}</code></pre></div>
                <div class="history-detail-actions">
                    <button class="history-action-btn copy-btn" onclick="copyHistoryCode('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        Copy Code
                    </button>
                    <button class="history-action-btn load-btn" onclick="loadFromHistory('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        Load in Editor
                    </button>
                    <button class="history-action-btn redo-btn" onclick="redoFromHistory('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21.5 2v6h-6"></path><path d="M21.34 15.57a10 10 0 1 1-.57-8.38L21.5 8"></path></svg>
                        Redo
                    </button>
                </div>
            </div>

            <div class="history-detail-section">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h4 class="history-section-label" style="margin-bottom:0;">📄 Problem Description</h4>
                    <button class="history-action-btn view-btn" id="editDescBtn" onclick="editHistoryDescription('${item.slug}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        Edit
                    </button>
                    <button class="history-action-btn run-btn" id="saveDescBtn" onclick="saveHistoryDescription('${item.slug}')" style="display:none; color:#111;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        Save
                    </button>
                </div>
                <div class="history-description" id="descDisplay">${item.description || "No description provided."}</div>
                <textarea class="history-description-textarea" id="descEdit" style="display:none;">${item.description || ""}</textarea>
            </div>

            <div class="history-detail-section">
                <a href="${item.url}" target="_blank" rel="noopener" class="history-action-btn load-btn" style="text-decoration:none;text-align:center;display:inline-flex;">
                    Open on LeetCode ↗
                </a>
            </div>
        </div>`;
}

function editHistoryDescription(slug) {
  document.getElementById("descDisplay").style.display = "none";
  const editArea = document.getElementById("descEdit");
  editArea.style.display = "block";
  editArea.focus();
  document.getElementById("editDescBtn").style.display = "none";
  document.getElementById("saveDescBtn").style.display = "inline-flex";
}

function saveHistoryDescription(slug) {
  const newDesc = document.getElementById("descEdit").value;
  const history = getHistory();
  const existingIdx = history.findIndex((h) => h.slug === slug);
  
  if (existingIdx >= 0) {
    history[existingIdx].description = newDesc;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    debouncedSync(); // Sync to cloud
    
    // Refresh the view
    viewHistoryDetail(slug);
  }
}

function backToHistoryList() {
  historyDetailView = false;
  loadHistory();
}

function copyHistoryCode(slug) {
  const history = getHistory();
  const item = history.find((h) => h.slug === slug);
  if (!item || !item.code) return;

  navigator.clipboard
    .writeText(item.code)
    .then(() => {
      // Brief visual feedback
      const btn = event.target.closest(".copy-btn");
      if (btn) {
        const origText = btn.innerHTML;
        btn.innerHTML = "✓ Copied!";
        setTimeout(() => {
          btn.innerHTML = origText;
        }, 1500);
      }
    })
    .catch(() => {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = item.code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function loadFromHistory(slug) {
  const history = getHistory();
  const item = history.find((h) => h.slug === slug);
  if (!item) return;

  if (item.isCustom || item.questionId === "Custom") {
    document.getElementById("urlInput").value = "Custom Problem: " + item.title;
    toggleHistory();
    
    // Reconstruct custom problem
    currentProblem = {
      titleSlug: item.slug,
      questionId: "Custom",
      title: item.title,
      difficulty: item.difficulty,
      content: item.description,
      metaData: item.metaData || "{}"
    };
    
    if (item.testCases) {
      testCases = [...item.testCases];
    } else {
      testCases = [];
    }
    
    renderProblem(currentProblem);
    renderTestCases();
    
    let pyTemplate = "";
    try {
      const meta = JSON.parse(currentProblem.metaData);
      const params = meta.params ? meta.params.map(p => p.name).join(', ') : "";
      const methodName = meta.name || "solve";
      pyTemplate = `class Solution:\n    def ${methodName}(self, ${params}):\n        pass\n`;
    } catch(e) {}
    
    currentProblem.codeSnippets = [{ langSlug: 'python3', code: pyTemplate }];
    
    setupEditor(currentProblem);
    if (item.code) {
      editor.setValue(item.code);
    }
    renderGoldenGutters();
    renderInsightsTab();
    
    document.getElementById("mainContent").style.display = "block";
    setupCustomCodeAutoSave();
    
  } else {
    document.getElementById("urlInput").value =
      `https://leetcode.com/problems/${slug}/`;
    toggleHistory();

    // Fetch the problem first, then load saved code
    fetchProblem().then(() => {
      if (item && item.code) {
        editor.setValue(item.code);
      }
      currentGoldenNotes = item.goldenNotes || {};
      renderGoldenGutters();
      renderInsightsTab();
    });
  }
}

function toggleHistory() {
  const sidebar = document.getElementById("historySidebar");
  const overlay = document.getElementById("historyOverlay");
  const isActive = sidebar.classList.contains("active");

  sidebar.classList.toggle("active");
  overlay.classList.toggle("active");

  if (!isActive) {
    historyDetailView = false;
    loadHistory(); // Refresh when opening
  }
}

function clearHistory() {
  if (confirm("Clear all problem history? This cannot be undone.")) {
    localStorage.removeItem(HISTORY_KEY);
    debouncedSync(); // Sync empty history to cloud
    loadHistory();
  }
}

// --- Favorites ---
function toggleFavorite(slug) {
  const history = getHistory();
  const item = history.find((h) => h.slug === slug);
  if (!item) return;
  item.favorite = !item.favorite;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  debouncedSync(); // Sync to cloud
  loadHistory();
}

function setHistoryFilter(filter) {
  historyFilter = filter;
  loadHistory();
}

function openFavorites() {
  historyFilter = "favorites";
  const sidebar = document.getElementById("historySidebar");
  const overlay = document.getElementById("historyOverlay");
  const isActive = sidebar.classList.contains("active");

  if (!isActive) {
    sidebar.classList.add("active");
    overlay.classList.add("active");
  }
  historyDetailView = false;
  loadHistory();
}

// --- Redo ---
function redoFromHistory(slug) {
  if (
    !confirm("This will erase your saved solution and start fresh. Continue?")
  )
    return;

  const history = getHistory();
  const item = history.find((h) => h.slug === slug);
  if (item) {
    item.code = "";
    item.status = "attempted";
    item.passCount = 0;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (typeof debouncedSync === 'function') debouncedSync(); // Sync to cloud
  }

  if (item && (item.isCustom || item.questionId === "Custom")) {
    document.getElementById("urlInput").value = "Custom Problem: " + item.title;
    toggleHistory();
    
    // Reconstruct custom problem
    currentProblem = {
      titleSlug: item.slug,
      questionId: "Custom",
      title: item.title,
      difficulty: item.difficulty,
      content: item.description,
      metaData: item.metaData || "{}"
    };
    
    if (item.testCases) {
      testCases = [...item.testCases];
    } else {
      testCases = [];
    }
    
    renderProblem(currentProblem);
    renderTestCases();
    
    let pyTemplate = "";
    try {
      const meta = JSON.parse(currentProblem.metaData);
      const params = meta.params ? meta.params.map(p => p.name).join(', ') : "";
      const methodName = meta.name || "solve";
      pyTemplate = `class Solution:\n    def ${methodName}(self, ${params}):\n        pass\n`;
    } catch(e) {}
    
    currentProblem.codeSnippets = [{ langSlug: 'python3', code: pyTemplate }];
    
    setupEditor(currentProblem);
    renderGoldenGutters();
    renderInsightsTab();
    document.getElementById("mainContent").style.display = "block";
    setupCustomCodeAutoSave();
  } else {
    // Load the problem fresh
    document.getElementById("urlInput").value =
      `https://leetcode.com/problems/${slug}/`;
    toggleHistory();
    fetchProblem(); // loads with original template (blank canvas)
  }
}

// --- Custom Problem & Editable Test Cases ---

// Debounced auto-save for custom problem code edits
let customCodeSaveTimeout = null;

function saveCustomProblemToHistory() {
  if (!currentProblem || currentProblem.questionId !== "Custom") return;

  const history = getHistory();
  const slug = currentProblem.titleSlug;
  const userCode = editor ? editor.getValue() : "";

  const existingIdx = history.findIndex((h) => h.slug === slug);

  const entry = {
    slug,
    title: currentProblem.title,
    questionId: "Custom",
    difficulty: currentProblem.difficulty,
    status: existingIdx >= 0 ? (history[existingIdx].status || "attempted") : "attempted",
    passCount: existingIdx >= 0 ? (history[existingIdx].passCount || 0) : 0,
    totalTests: testCases.length,
    lastAttempt: new Date().toISOString(),
    attempts: existingIdx >= 0 ? (history[existingIdx].attempts || 0) : 0,
    url: "",
    code: userCode,
    description: currentProblem.content || "",
    favorite: existingIdx >= 0 ? (history[existingIdx].favorite || false) : false,
    isCustom: true,
    metaData: currentProblem.metaData,
    testCases: JSON.parse(JSON.stringify(testCases)),
    goldenNotes: currentGoldenNotes
  };

  if (existingIdx >= 0) {
    history[existingIdx] = entry;
  } else {
    history.unshift(entry);
  }

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  if (typeof debouncedSync === 'function') debouncedSync();
}

function setupCustomCodeAutoSave() {
  if (!editor) return;
  editor.on("change", () => {
    if (!currentProblem || currentProblem.questionId !== "Custom") return;
    if (customCodeSaveTimeout) clearTimeout(customCodeSaveTimeout);
    customCodeSaveTimeout = setTimeout(() => {
      saveCustomProblemToHistory();
    }, 1500);
  });
}

function openCustomModal() {
  document.getElementById("customProblemModal").classList.add("active");
  document.getElementById("customTitle").focus();
}

function closeCustomModal() {
  document.getElementById("customProblemModal").classList.remove("active");
  document.getElementById("customError").textContent = "";
}

function submitCustomProblem() {
  const titleInput = document.getElementById("customTitle").value.trim() || "Custom Problem";
  const methodInput = document.getElementById("customMethod").value.trim() || "solve";
  const paramsInput = document.getElementById("customParams").value.trim() || "param1";
  
  // Parse params
  const params = paramsInput.split(',').map(p => p.trim()).filter(p => p);

  // Construct faux currentProblem
  currentProblem = {
    titleSlug: titleInput.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now(),
    questionId: "Custom",
    title: titleInput,
    difficulty: "Medium",
    content: `<p>This is a custom problem. You can write your own solution and define custom test cases below.</p>`,
    metaData: JSON.stringify({
      name: methodInput,
      params: params.map(p => ({ name: p, type: "Any" })),
      return: { type: "Any" }
    })
  };

  testCases = [];
  currentGoldenNotes = {};

  // Construct Python Template
  let pyTemplate = `class Solution:\n    def ${methodInput}(self, ${params.join(', ')}):\n        pass\n`;
  currentProblem.codeSnippets = [{ langSlug: 'python3', code: pyTemplate }];

  // Render
  renderProblem(currentProblem);
  renderTestCases();
  setupEditor(currentProblem);

  document.getElementById("mainContent").style.display = "block";
  closeCustomModal();
  
  // Clear inputs
  document.getElementById("customTitle").value = "";
  document.getElementById("customMethod").value = "";
  document.getElementById("customParams").value = "";
  
  // Save immediately so the problem persists before running tests
  saveCustomProblemToHistory();
  
  // Setup auto-save for code edits
  setupCustomCodeAutoSave();
  
  // Switch to Testcases tab to encourage adding tests
  switchTab("testcases");
}

function updateTestCase(index, type, key, value) {
  if (type === 'input') {
    testCases[index].inputs[key] = value;
  } else if (type === 'expected') {
    testCases[index].expected = value;
  }
  saveCustomProblemToHistory();
}

function addNewTestCase() {
  if (!currentProblem) {
    alert("Please load or create a problem first.");
    return;
  }

  let metaData = {};
  try {
    metaData = JSON.parse(currentProblem.metaData || "{}");
  } catch(e) {}

  const params = metaData.params || [];
  
  const newInputs = {};
  for (const p of params) {
    const pName = p.name || `param${Object.keys(newInputs).length}`;
    newInputs[pName] = "";
  }

  // If there are no params parsed, just add a generic generic input
  if (Object.keys(newInputs).length === 0) {
    newInputs["input"] = "";
  }

  testCases.push({
    inputs: newInputs,
    expected: ""
  });

  renderTestCases();
  saveCustomProblemToHistory();
}

function removeTestCase(index) {
  testCases.splice(index, 1);
  renderTestCases();
  saveCustomProblemToHistory();
}

// --- Golden Notes ---

let activeNoteLine = null;

function openGoldenNoteModal(lineIndex) {
  if (!currentProblem) return;
  activeNoteLine = lineIndex;
  
  const modal = document.getElementById("goldenNoteModal");
  const subtitle = document.getElementById("goldenNoteSubtitle");
  const textInput = document.getElementById("goldenNoteText");
  const deleteBtn = document.getElementById("deleteGoldenNoteBtn");
  
  subtitle.textContent = `Line ${lineIndex + 1}`;
  
  if (currentGoldenNotes[lineIndex]) {
    textInput.value = currentGoldenNotes[lineIndex].text;
    deleteBtn.style.display = "block";
  } else {
    textInput.value = "";
    deleteBtn.style.display = "none";
  }
  
  modal.classList.add("active");
  textInput.focus();
}

function closeGoldenNoteModal() {
  document.getElementById("goldenNoteModal").classList.remove("active");
  activeNoteLine = null;
}

function saveGoldenNoteFromModal() {
  if (activeNoteLine === null) return;
  
  const text = document.getElementById("goldenNoteText").value.trim();
  if (text) {
    currentGoldenNotes[activeNoteLine] = {
      text: text,
      timestamp: new Date().toISOString()
    };
  } else {
    delete currentGoldenNotes[activeNoteLine];
  }
  
  finishGoldenNoteEdit();
}

function deleteGoldenNoteFromModal() {
  if (activeNoteLine === null) return;
  delete currentGoldenNotes[activeNoteLine];
  finishGoldenNoteEdit();
}

function finishGoldenNoteEdit() {
  closeGoldenNoteModal();
  renderGoldenGutters();
  renderInsightsTab();
  
  // Persist
  if (currentProblem.questionId === "Custom") {
    saveCustomProblemToHistory();
  } else {
    // For standard problems, only save if it's already in history
    // (or we can just force save right now so insights aren't lost)
    const history = getHistory();
    const existingIdx = history.findIndex((h) => h.slug === currentProblem.titleSlug);
    if (existingIdx >= 0) {
      history[existingIdx].goldenNotes = currentGoldenNotes;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      if (typeof debouncedSync === 'function') debouncedSync();
      loadHistory();
    } else {
      // Create a dummy attempt entry to hold the notes
      saveToHistory(false, 0, testCases.length);
    }
  }
}

function renderGoldenGutters() {
  if (!editor) return;
  
  // Clear existing
  editor.clearGutter("golden-gutter");
  for (let i = 0; i < editor.lineCount(); i++) {
    editor.removeLineClass(i, "background", "golden-line-highlight");
  }
  
  // Add new
  for (const [lineIdxStr, noteData] of Object.entries(currentGoldenNotes)) {
    const lineIdx = parseInt(lineIdxStr, 10);
    
    if (lineIdx < editor.lineCount()) {
      // Add marker
      const marker = document.createElement("div");
      marker.className = "golden-marker";
      marker.innerHTML = "✨";
      marker.title = noteData.text;
      
      editor.setGutterMarker(lineIdx, "golden-gutter", marker);
      
      // Add highlight class
      editor.addLineClass(lineIdx, "background", "golden-line-highlight");
    }
  }
}

function renderInsightsTab() {
  const container = document.getElementById("insightsList");
  if (!container) return;
  
  const noteEntries = Object.entries(currentGoldenNotes);
  
  if (noteEntries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✨</div>
        <p class="empty-state-text">No insights added yet.<br>Click an editor line to add one!</p>
      </div>`;
    return;
  }
  
  // Sort by line number
  noteEntries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  
  container.innerHTML = noteEntries.map(([lineStr, note]) => {
    const lineNum = parseInt(lineStr, 10) + 1;
    const date = new Date(note.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    return `
      <div class="insight-card">
        <div class="insight-header">
          <div class="insight-line" onclick="scrollToEditorLine(${lineStr})" title="Click to view in editor">Line ${lineNum} ↵</div>
          <div class="insight-date">${dateStr}</div>
        </div>
        <div class="insight-text">${escapeHtml(note.text)}</div>
      </div>
    `;
  }).join('');
}

function scrollToEditorLine(lineIdx) {
  if (!editor) return;
  // Make sure we switch to the editor space if on mobile not viewing it
  editor.scrollIntoView({ line: lineIdx, ch: 0 }, 100);
  editor.setCursor({ line: lineIdx, ch: 0 });
  editor.focus();
}
