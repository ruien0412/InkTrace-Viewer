const repoUrlInput = document.getElementById('repoUrl')
const branchInput = document.getElementById('branch')
const tokenInput = document.getElementById('token')
const destinationInput = document.getElementById('destination')
const historySelect = document.getElementById('historySelect')
const pickFolderBtn = document.getElementById('pickFolderBtn')
const cloneBtn = document.getElementById('cloneBtn')
const openRepoBtn = document.getElementById('openRepoBtn')
const cancelBtn = document.getElementById('cancelBtn')
const status = document.getElementById('status')
const logs = document.getElementById('logs')
const svgSearch = document.getElementById('svgSearch')
const svgList = document.getElementById('svgList')
const previewTitle = document.getElementById('previewTitle')
const previewContainer = document.getElementById('previewContainer')

const PAGE_SIZE = 200

let activeJobId = null
let currentRepoDirectory = ''
let allSvgFiles = []
let filteredSvgFiles = []
let selectedSvgPath = ''
let renderCount = PAGE_SIZE
let historyRecords = []

function buildHistoryKey(record) {
	return `${record.repoUrl}@@${record.branch}`
}

function applyHistoryRecord(record) {
	if (!record) {
		return
	}
	repoUrlInput.value = record.repoUrl || ''
	branchInput.value = record.branch || 'main'
	destinationInput.value = record.destinationFolder || ''
	tokenInput.value = record.token || ''
}

function renderHistorySelect(records) {
	historySelect.innerHTML = '<option value="">請選擇</option>'
	for (const record of records) {
		const option = document.createElement('option')
		option.value = buildHistoryKey(record)
		option.textContent = `${record.repoUrl} [${record.branch}]`
		historySelect.appendChild(option)
	}
}

function decodeUnicodeFilename(relativePath) {
	const filename = relativePath.split('/').pop() || relativePath
	const stem = filename.replace(/\.svg$/i, '')
	const variantMatch = stem.match(/-(\d+)$/)
	const variantNumber = variantMatch ? Number(variantMatch[1]) : null
	const baseStem = variantMatch ? stem.slice(0, -variantMatch[0].length) : stem

	const codeTokens = baseStem.split('_').filter(Boolean)
	if (codeTokens.length === 0) {
		return null
	}

	const codePoints = []
	for (const token of codeTokens) {
		const tokenMatch = token.match(/^U\+([0-9A-Fa-f]{4,6})$/)
		if (!tokenMatch) {
			return null
		}

		const codePoint = Number.parseInt(tokenMatch[1], 16)
		if (!Number.isFinite(codePoint)) {
			return null
		}
		codePoints.push(codePoint)
	}

	const text = String.fromCodePoint(...codePoints)
	const variantLabel =
		variantNumber === null ? '' : variantNumber === 1 ? '變種' : `變種-${variantNumber}`
	const displayLabel = variantLabel ? `${text}（${variantLabel}）` : text

	return {
		text,
		variantNumber,
		variantLabel,
		codeLabel: codeTokens.join('_'),
		displayLabel
	}
}

function setSvgFiles(files) {
	allSvgFiles = files.map((file) => {
		const decoded = decodeUnicodeFilename(file.relativePath)
		const displayLabel = decoded ? `${decoded.displayLabel} ｜ ${file.relativePath}` : file.relativePath
		const searchText = [
			file.relativePath,
			decoded?.text || '',
			decoded?.codeLabel || '',
			decoded?.variantLabel || ''
		]
			.join(' ')
			.toLowerCase()

		return {
			...file,
			decoded,
			displayLabel,
			searchText
		}
	})
	applySvgSearch()
}

function applySvgSearch() {
	const keyword = svgSearch.value.trim().toLowerCase()
	if (!keyword) {
		filteredSvgFiles = allSvgFiles.slice()
	} else {
		filteredSvgFiles = allSvgFiles.filter((file) => file.searchText.includes(keyword))
	}

	renderCount = PAGE_SIZE
	renderSvgList()

	if (filteredSvgFiles.length === 0) {
		previewTitle.textContent = '預覽'
		previewContainer.classList.add('preview-empty')
		previewContainer.textContent = '查無符合條件的 SVG。'
	}
}

function appendLog(message) {
	const now = new Date().toLocaleTimeString('zh-TW', { hour12: false })
	logs.textContent += `[${now}] ${message}\n`
	logs.scrollTop = logs.scrollHeight
}

function setStatus(message) {
	status.textContent = message
}

function setBusy(isBusy) {
	cloneBtn.disabled = isBusy
	openRepoBtn.disabled = isBusy
	cancelBtn.disabled = !isBusy
	pickFolderBtn.disabled = isBusy
}

function clearSvgListAndPreview() {
	allSvgFiles = []
	filteredSvgFiles = []
	selectedSvgPath = ''
	renderCount = PAGE_SIZE
	svgList.innerHTML = ''
	previewTitle.textContent = '預覽'
	previewContainer.classList.add('preview-empty')
	previewContainer.textContent = '請先選擇 SVG 檔案。'
}

function loadMoreIfNeeded() {
	const nearBottom = svgList.scrollTop + svgList.clientHeight >= svgList.scrollHeight - 40
	if (nearBottom && renderCount < filteredSvgFiles.length) {
		renderCount = Math.min(renderCount + PAGE_SIZE, filteredSvgFiles.length)
		renderSvgList()
	}
}

function renderSvgList() {
	const fragment = document.createDocumentFragment()
	for (const file of filteredSvgFiles.slice(0, renderCount)) {
		const item = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = file.displayLabel
		if (file.fullPath === selectedSvgPath) {
			button.classList.add('selected')
		}

		button.addEventListener('click', async () => {
			selectedSvgPath = file.fullPath
			await showPreview(file.fullPath, file.relativePath)
			renderSvgList()
		})

		item.appendChild(button)
		fragment.appendChild(item)
	}

	svgList.innerHTML = ''
	svgList.appendChild(fragment)
}

async function showPreview(svgPath, relativePath) {
	const decoded = decodeUnicodeFilename(relativePath)
	previewTitle.textContent = decoded
		? `預覽：${decoded.displayLabel} ｜ ${relativePath}`
		: `預覽：${relativePath}`
	previewContainer.classList.remove('preview-empty')
	previewContainer.textContent = '載入中...'

	try {
		const response = await window.appApi.loadSvgPreview(svgPath)
		const img = document.createElement('img')
		img.alt = relativePath
		img.src = response.dataUrl
		previewContainer.innerHTML = ''
		previewContainer.appendChild(img)
	} catch (error) {
		previewContainer.classList.add('preview-empty')
		previewContainer.textContent = '預覽失敗。'
		appendLog(`預覽失敗：${error.message}`)
	}
}

async function refreshSvgList() {
	if (!currentRepoDirectory) {
		return
	}

	setStatus('正在掃描 SVG...')
	appendLog(`掃描 SVG：${currentRepoDirectory}`)

	try {
		const response = await window.appApi.listSvgs(currentRepoDirectory)
		setSvgFiles(response.files || [])
		setStatus(`掃描完成，共 ${allSvgFiles.length} 個 SVG。`)
		appendLog(`掃描完成，共 ${allSvgFiles.length} 個 SVG。`)
		if (allSvgFiles.length === 0) {
			previewTitle.textContent = '預覽'
			previewContainer.classList.add('preview-empty')
			previewContainer.textContent = '找不到 SVG 檔案。'
		}
	} catch (error) {
		setStatus('掃描 SVG 失敗。')
		appendLog(`掃描失敗：${error.message}`)
	}
}

pickFolderBtn.addEventListener('click', async () => {
	const result = await window.appApi.pickFolder()
	if (!result.canceled && result.folderPath) {
		destinationInput.value = result.folderPath
	}
})

historySelect.addEventListener('change', () => {
	const value = historySelect.value
	if (!value) {
		return
	}

	const selected = historyRecords.find((record) => buildHistoryKey(record) === value)
	applyHistoryRecord(selected)
})

svgSearch.addEventListener('input', () => {
	applySvgSearch()
})

openRepoBtn.addEventListener('click', async () => {
	const result = await window.appApi.pickFolder()
	if (result.canceled || !result.folderPath) {
		return
	}

	setStatus('檢查資料夾中...')
	appendLog(`檢查 Repo：${result.folderPath}`)

	try {
		const inspected = await window.appApi.inspectRepo(result.folderPath)
		if (!inspected.isGitRepo) {
			setStatus('這個資料夾不是 Git Repo（找不到 .git）。')
			appendLog('開啟失敗：資料夾不是 Git Repo。')
			return
		}

		currentRepoDirectory = result.folderPath
		destinationInput.value = result.folderPath
		clearSvgListAndPreview()
		setStatus('已開啟本機 Repo，準備掃描 SVG。')
		appendLog(`已開啟本機 Repo：${currentRepoDirectory}`)
		await refreshSvgList()
	} catch (error) {
		setStatus('開啟本機 Repo 失敗。')
		appendLog(`開啟失敗：${error.message}`)
	}
})

cloneBtn.addEventListener('click', async () => {
	const repoUrl = repoUrlInput.value.trim()
	const branch = branchInput.value.trim() || 'main'
	const destinationFolder = destinationInput.value.trim()
	const token = tokenInput.value.trim()

	if (!repoUrl) {
		setStatus('請輸入 GitHub repo URL。')
		return
	}

	if (!destinationFolder) {
		setStatus('請先選擇下載資料夾。')
		return
	}

	clearSvgListAndPreview()
	logs.textContent = ''
	setBusy(true)
	setStatus('正在開始 clone...')
	appendLog(`開始 clone：${repoUrl}（branch: ${branch}）`)

	try {
		const settingsResult = await window.appApi.saveSettings({
			repoUrl,
			branch,
			destinationFolder,
			token
		})
		historyRecords = settingsResult.settings.history || []
		renderHistorySelect(historyRecords)

		const startResult = await window.appApi.startClone({
			repoUrl,
			branch,
			destinationFolder,
			token
		})

		activeJobId = startResult.jobId
		currentRepoDirectory = startResult.targetDirectory
		appendLog(`工作 ID：${activeJobId}`)
	} catch (error) {
		setBusy(false)
		setStatus('無法啟動 clone。')
		appendLog(`啟動失敗：${error.message}`)
	}
})

async function initializeSettings() {
	try {
		const response = await window.appApi.getSettings()
		const settings = response.settings || {}
		historyRecords = settings.history || []
		renderHistorySelect(historyRecords)
		applyHistoryRecord(settings.lastUsed)
	} catch (error) {
		appendLog(`載入設定失敗：${error.message}`)
	}
}

cancelBtn.addEventListener('click', async () => {
	if (!activeJobId) {
		return
	}

	try {
		await window.appApi.cancelClone(activeJobId)
		appendLog('已送出取消請求。')
		setStatus('已取消。')
	} catch (error) {
		appendLog(`取消失敗：${error.message}`)
	} finally {
		activeJobId = null
		setBusy(false)
	}
})

const offProgress = window.appApi.onCloneProgress((event) => {
	if (activeJobId && event.jobId !== activeJobId) {
		return
	}

	if (typeof event.percent === 'number') {
		setStatus(`Clone 中... ${event.percent}%`)
	} else {
		setStatus('Clone 中...')
	}

	appendLog(event.message)
})

const offDone = window.appApi.onCloneDone(async (event) => {
	if (activeJobId && event.jobId !== activeJobId) {
		return
	}

	activeJobId = null
	setBusy(false)

	if (event.ok) {
		setStatus('Clone 完成，準備掃描 SVG。')
		appendLog(event.message)
		currentRepoDirectory = event.targetDirectory || currentRepoDirectory
		await refreshSvgList()
	} else {
		setStatus('Clone 失敗。')
		appendLog(event.message)
	}
})

svgList.addEventListener('scroll', loadMoreIfNeeded)

window.addEventListener('beforeunload', () => {
	offProgress()
	offDone()
})

initializeSettings()
