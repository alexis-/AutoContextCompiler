// @ts-check

const vscode = acquireVsCodeApi();
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
let completionList = null;
let selectedIndex = -1;
let currentTagRange = null;
let isProcessingCompletion = false;

function escapeHtml(str) {
    // Replace special HTML characters with entities
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Handle input in the editor
editor.addEventListener('input', (e) => {
    if (isProcessingCompletion) return;
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    
    // Get the current text node and its content
    let currentNode = range.startContainer;
    let currentOffset = range.startOffset;
    
    // If we're not in a text node, return
    if (currentNode.nodeType !== Node.TEXT_NODE) return;
    
    // Get text before cursor in current node
    const beforeCursor = currentNode.textContent.substring(0, currentOffset);
    
    // Check if we're typing a tag
    const tagMatch = beforeCursor.match(/@[^\s@]*$/);
    
    if (tagMatch) {
        const query = tagMatch[0].substring(1);
        const tagStartOffset = tagMatch.index;
        
        // Create a range for the current tag
        currentTagRange = document.createRange();
        currentTagRange.setStart(currentNode, tagStartOffset);
        currentTagRange.setEnd(currentNode, currentOffset);
        
        vscode.postMessage({ 
            type: 'getFileCompletion',
            query
        });
    } else {
        hideCompletions();
        updatePreview();
    }
});

// Handle keyboard events for the editor
editor.addEventListener('keydown', (e) => {
    if (completionList) {
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectNextCompletion();
                return;
            case 'ArrowUp':
                e.preventDefault();
                selectPrevCompletion();
                return;
            case 'Enter':
            case 'Tab':
                if (selectedIndex !== -1) {
                    e.preventDefault();
                    acceptCompletion();
                    return;
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideCompletions();
                return;
        }
    }

    // Handle left/right arrow navigation around tags
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        const offset = range.startOffset;

        // Find the closest tag element
        let tagElement = null;
        if (node.nodeType === Node.TEXT_NODE) {
            if (e.key === 'ArrowRight' && node.nextSibling?.classList?.contains('tag')) {
                tagElement = node.nextSibling;
            } else if (e.key === 'ArrowLeft' && node.previousSibling?.classList?.contains('tag')) {
                tagElement = node.previousSibling;
            }
        }

        if (tagElement) {
            e.preventDefault();
            const newRange = document.createRange();
            if (e.key === 'ArrowRight') {
                newRange.setStartAfter(tagElement);
            } else {
                newRange.setStartBefore(tagElement);
            }
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            return;
        }
    }
    
    if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        
        // If the cursor is at the very beginning of a text node
        // whose previous sibling is a locked-in tag, then break the tag
        if (node.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
            const prevSibling = node.previousSibling;
            if (prevSibling && prevSibling.classList?.contains('tag')) {
                e.preventDefault();
                const tagText = '@' + prevSibling.textContent;
                const textNode = document.createTextNode(tagText);
                prevSibling.replaceWith(textNode);
                
                // Set cursor at the end of the inserted text
                const newRange = document.createRange();
                newRange.setStart(textNode, tagText.length);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                updatePreview();
            }
        }
    }
});

// Add click handler to prevent cursor inside tags
editor.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList?.contains('tag')) {
        e.preventDefault();
        const selection = window.getSelection();
        const range = document.createRange();
        
        // Place cursor after tag if click is on right half, before if on left half
        const clickX = e.clientX;
        const rect = target.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        
        if (clickX > midX) {
            range.setStartAfter(target);
        } else {
            range.setStartBefore(target);
        }
        
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }
});

function showCompletions(items) {
    if (!items.length || !currentTagRange) {
        hideCompletions();
        return;
    }

    if (!completionList) {
        completionList = document.createElement('div');
        completionList.className = 'completion-list';
        document.body.appendChild(completionList);
    }

    // Get the range's client rect relative to the editor
    const editorRect = editor.getBoundingClientRect();
    const rangeRect = currentTagRange.getBoundingClientRect();
    
    // Position near the tag
    completionList.style.left = (rangeRect.right - editorRect.left + 40) + 'px';
    completionList.style.top = (rangeRect.top - editorRect.top) + 'px';
    
    // If there's not enough space to the right, position below
    if (rangeRect.right + 205 > window.innerWidth) {
        completionList.style.left = (rangeRect.left - editorRect.left) + 'px';
        completionList.style.top = (rangeRect.bottom - editorRect.top + 5) + 'px';
    }
    
    completionList.style.maxHeight = (window.innerHeight - rangeRect.bottom - 10) + 'px';

    completionList.innerHTML = items
        .map((item, index) => `
            <div class="completion-item" data-index="${index}">
                ${item}
            </div>
        `)
        .join('');

    selectedIndex = 0;
    updateSelectedCompletion();

    completionList.querySelectorAll('.completion-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedIndex = parseInt(item.dataset.index);
            acceptCompletion();
        });
    });
}

function hideCompletions() {
    if (completionList) {
        completionList.remove();
        completionList = null;
    }
    currentTagRange = null;
    selectedIndex = -1;
}

function selectNextCompletion() {
    if (!completionList) return;
    selectedIndex = (selectedIndex + 1) % completionList.children.length;
    updateSelectedCompletion();
}

function selectPrevCompletion() {
    if (!completionList) return;
    selectedIndex = selectedIndex <= 0 ?
        completionList.children.length - 1 : 
        selectedIndex - 1;
    updateSelectedCompletion();
}

function updateSelectedCompletion() {
    completionList.querySelectorAll('.completion-item').forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
        if (index === selectedIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

function acceptCompletion() {
    if (!completionList || selectedIndex === -1 || !currentTagRange) return;
    
    isProcessingCompletion = true;
    
    try {
        const selectedItem = completionList.children[selectedIndex].textContent.trim();
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = selectedItem;
        tag.contentEditable = 'false';  // Make tag non-editable
        
        // Replace the @text with our tag
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(currentTagRange);
        
        currentTagRange.deleteContents();
        currentTagRange.insertNode(tag);
        
        // Move cursor after tag
        const range = document.createRange();
        range.setStartAfter(tag);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Add a space after the tag if there isn't one
        const nextNode = tag.nextSibling;
        if (!nextNode || (nextNode.nodeType === Node.TEXT_NODE && !nextNode.textContent.startsWith(' '))) {
            tag.after(document.createTextNode(' '));
        }
        
        hideCompletions();
        updatePreview();
    } finally {
        isProcessingCompletion = false;
    }
}

function updatePreview() {
    // Clear the preview before refilling it
    preview.textContent = '';

    const tags = Array.from(editor.getElementsByClassName('tag'));

    tags.forEach(tag => {
        const path = tag.textContent;
        vscode.postMessage({
            type: 'getFileContent',
            path
        });
    });
}

function appendFileContent(path, content) {
    // Make sure we escape everything so that <script>, <template>, etc. show up literally
    const escaped = escapeHtml(content);
    const extension = path.split('.').pop() || '';
    
    if (escaped.trim()) {
        preview.innerHTML += `${path}\n\`\`\`${extension}\n${escaped}\n\`\`\`\n\n`;
    }
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'completions':
            showCompletions(message.items);
            break;
        case 'fileContent':
            // Handle array of file entries
            for (const fileObj of message.items) {
                appendFileContent(fileObj.path, fileObj.content);
            }
            break;
        case 'update':
            updatePreview();
            break;
    }
});
