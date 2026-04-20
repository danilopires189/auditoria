[CmdletBinding()]
param(
    [string]$SourceRoot = "docs/training-manual",
    [string]$OutputMarkdown = "docs/manual-treinamento-operacional.md",
    [string]$OutputDocx = "docs/manual-treinamento-operacional.docx"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$wdCollapseEnd = 0
$wdPageBreak = 7
$wdFormatDocumentDefault = 16
$wdHeaderFooterPrimary = 1
$wdFieldPage = 33
$wdAlignParagraphLeft = 0
$wdAlignParagraphCenter = 1
$wdAlignParagraphRight = 2
$wdColorGray15 = 14277081
$wdColorGray10 = 15132390
$wdLineStyleSingle = 1
$wdBorderLeft = 1
$wdBorderTop = 2
$wdBorderBottom = 3
$wdBorderRight = 4
$wdListContinueNumbering = 7

function Resolve-RepoPath {
    param([string]$RelativePath)
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $RelativePath))
}

function Normalize-InlineText {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $normalized = $Text -replace "\*\*", ""
    $normalized = $normalized.Replace([string][char]96, "")
    return $normalized.Trim()
}

function Get-RegistryModules {
    $registryPath = Resolve-RepoPath "frontend/src/modules/registry.ts"
    $content = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8
    $matches = [regex]::Matches($content, '\{\s*key:\s*"(?<key>[^"]+)"\s*,\s*path:\s*"[^"]+"\s*,\s*title:\s*"(?<title>[^"]+)"')
    return $matches | ForEach-Object {
        [pscustomobject]@{
            Key   = $_.Groups["key"].Value
            Title = $_.Groups["title"].Value
        }
    }
}

function Get-ActiveMenuKeys {
    $homePath = Resolve-RepoPath "frontend/src/pages/HomePage.tsx"
    $content = Get-Content -LiteralPath $homePath -Raw -Encoding UTF8
    $setMatch = [regex]::Match($content, 'const AVAILABLE_MODULE_KEYS = new Set\(\[(?<body>.*?)\]\);', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $setMatch.Success) {
        throw "Nao foi possivel localizar AVAILABLE_MODULE_KEYS em frontend/src/pages/HomePage.tsx."
    }
    $keys = [regex]::Matches($setMatch.Groups["body"].Value, '"(?<key>[^"]+)"') | ForEach-Object {
        $_.Groups["key"].Value
    }
    return $keys | Where-Object { $_ -ne "registro-embarque" }
}

function Get-ExpectedModules {
    $registry = Get-RegistryModules
    $activeKeys = Get-ActiveMenuKeys
    $activeSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$activeKeys)
    return $registry | Where-Object { $activeSet.Contains($_.Key) -and $_.Key -ne "registro-embarque" }
}

function Get-SourceFiles {
    param([string]$Root)
    $ordered = @()
    foreach ($subdir in @("00-frontmatter", "01-geral", "02-modulos", "03-anexos")) {
        $full = Join-Path $Root $subdir
        if (-not (Test-Path -LiteralPath $full)) {
            throw "Pasta obrigatoria ausente: $full"
        }
        $ordered += Get-ChildItem -LiteralPath $full -Filter *.md | Sort-Object Name
    }
    return $ordered
}

function Test-ModuleCoverage {
    param(
        [string]$Root,
        [object[]]$ExpectedModules
    )
    $moduleDir = Join-Path $Root "02-modulos"
    $moduleFiles = Get-ChildItem -LiteralPath $moduleDir -Filter *.md | Sort-Object Name
    $missing = @()
    foreach ($module in $ExpectedModules) {
        $matched = $moduleFiles | Where-Object { $_.BaseName -match "(^|\-)$([regex]::Escape($module.Key))$" }
        if (-not $matched) {
            $missing += $module.Key
        }
    }
    if ($missing.Count -gt 0) {
        throw "Arquivos de modulo ausentes em docs/training-manual/02-modulos: $($missing -join ', ')"
    }
    $unexpectedRegistro = $moduleFiles | Where-Object { $_.BaseName -match "(^|\-)registro-embarque$" }
    if ($unexpectedRegistro) {
        throw "Modulo placeholder 'registro-embarque' nao deve entrar no manual."
    }
}

function New-CalloutTable {
    param(
        $Document,
        $Selection,
        [string]$Type,
        [string]$Body
    )
    $typeLabels = @{
        "ATENCAO" = "ATENCAO"
        "DICA"    = "DICA"
        "REGRA"   = "REGRA"
        "ERRO"    = "ERRO COMUM"
    }
    $typeColors = @{
        "ATENCAO" = 13883367
        "DICA"    = 15592416
        "REGRA"   = 15395562
        "ERRO"    = 14145495
    }
    $Selection.Style = "Normal"
    $Selection.TypeText("$($typeLabels[$Type]): $(Normalize-InlineText $Body)")
    $Selection.TypeParagraph()
    $paragraphRange = $Document.Paragraphs.Item($Document.Paragraphs.Count).Range
    $paragraphRange.Shading.BackgroundPatternColor = $typeColors[$Type]
    $paragraphRange.Font.Name = "Aptos"
    $paragraphRange.Font.Size = 10.5
    $paragraphRange.Font.Bold = $true
    $Selection.TypeParagraph()
}

function New-ImagePlaceholder {
    param(
        $Document,
        $Selection,
        [string]$Body
    )
    $Selection.Style = "Normal"
    $Selection.TypeText("INSERIR IMAGEM - $(Normalize-InlineText $Body)")
    $Selection.TypeParagraph()
    $paragraphRange = $Document.Paragraphs.Item($Document.Paragraphs.Count).Range
    $paragraphRange.ParagraphFormat.Alignment = $wdAlignParagraphCenter
    $paragraphRange.Font.Name = "Aptos"
    $paragraphRange.Font.Size = 10
    $paragraphRange.Font.Italic = $true
    $paragraphRange.Shading.BackgroundPatternColor = $wdColorGray10
    $paragraphRange.Borders.Enable = $true
    $Selection.TypeParagraph()
}

function Add-ParagraphLine {
    param(
        $Selection,
        [string]$Text,
        [string]$Style
    )
    $Selection.Style = $Style
    $Selection.TypeText((Normalize-InlineText $Text))
    $Selection.TypeParagraph()
}

function Add-BulletList {
    param($Document, $Selection, [string[]]$Items)
    foreach ($item in $Items) {
        $Selection.Style = "Normal"
        $Selection.TypeText([char]8226 + " " + (Normalize-InlineText $item))
        $Selection.TypeParagraph()
    }
}

function Add-NumberedList {
    param($Document, $Selection, [string[]]$Items)
    for ($index = 0; $index -lt $Items.Count; $index++) {
        $Selection.Style = "Normal"
        $Selection.TypeText("$($index + 1). " + (Normalize-InlineText $Items[$index]))
        $Selection.TypeParagraph()
    }
}

function Set-DocumentStyles {
    param($Document)
    $Document.Styles.Item("Normal").Font.Name = "Aptos"
    $Document.Styles.Item("Normal").Font.Size = 10.5
    $Document.Styles.Item("Normal").ParagraphFormat.SpaceAfter = 6
    $Document.Styles.Item("Title").Font.Name = "Cambria"
    $Document.Styles.Item("Title").Font.Size = 24
    $Document.Styles.Item("Title").Font.Bold = $true
    $Document.Styles.Item("Title").Font.Color = 4473924
    $Document.Styles.Item("Heading 1").Font.Name = "Cambria"
    $Document.Styles.Item("Heading 1").Font.Size = 19
    $Document.Styles.Item("Heading 1").Font.Bold = $true
    $Document.Styles.Item("Heading 1").Font.Color = 4473924
    $Document.Styles.Item("Heading 1").ParagraphFormat.SpaceBefore = 18
    $Document.Styles.Item("Heading 1").ParagraphFormat.SpaceAfter = 8
    $Document.Styles.Item("Heading 2").Font.Name = "Cambria"
    $Document.Styles.Item("Heading 2").Font.Size = 14
    $Document.Styles.Item("Heading 2").Font.Bold = $true
    $Document.Styles.Item("Heading 2").Font.Color = 4473924
    $Document.Styles.Item("Heading 3").Font.Name = "Cambria"
    $Document.Styles.Item("Heading 3").Font.Size = 11.5
    $Document.Styles.Item("Heading 3").Font.Bold = $true
    $Document.Styles.Item("Heading 3").Font.Color = 6003426
}

function Build-ConsolidatedMarkdown {
    param(
        [System.IO.FileInfo[]]$Files,
        [string]$Destination
    )
    $segments = New-Object System.Collections.Generic.List[string]
    for ($index = 0; $index -lt $Files.Count; $index++) {
        if ($index -gt 0) {
            $segments.Add("")
            $segments.Add("[[PAGEBREAK]]")
            $segments.Add("")
        }
        $content = Get-Content -LiteralPath $Files[$index].FullName -Raw -Encoding UTF8
        $segments.Add($content.TrimEnd())
    }
    $joined = ($segments -join [Environment]::NewLine) + [Environment]::NewLine
    $outDir = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    [System.IO.File]::WriteAllText((Resolve-RepoPath $Destination), $joined, [System.Text.UTF8Encoding]::new($false))
}

function Convert-MarkdownToHtml {
    param([string[]]$MarkdownLines)
    $html = New-Object System.Text.StringBuilder
    [void]$html.AppendLine('<!DOCTYPE html>')
    [void]$html.AppendLine('<html lang="pt-BR"><head><meta charset="utf-8" />')
    [void]$html.AppendLine('<style>')
    [void]$html.AppendLine('body { font-family: Aptos, Calibri, Arial, sans-serif; color: #223046; margin: 36pt 42pt; line-height: 1.45; }')
    [void]$html.AppendLine('h1 { font-family: Cambria, Georgia, serif; color: #1f365c; font-size: 24pt; margin: 0 0 12pt; page-break-after: avoid; }')
    [void]$html.AppendLine('h2 { font-family: Cambria, Georgia, serif; color: #1f365c; font-size: 16pt; margin: 18pt 0 8pt; page-break-after: avoid; }')
    [void]$html.AppendLine('h3 { font-family: Cambria, Georgia, serif; color: #37507a; font-size: 12pt; margin: 14pt 0 6pt; page-break-after: avoid; }')
    [void]$html.AppendLine('p { margin: 0 0 8pt; }')
    [void]$html.AppendLine('ul, ol { margin: 0 0 10pt 20pt; }')
    [void]$html.AppendLine('.callout { margin: 8pt 0; padding: 10pt 12pt; border-left: 4pt solid #5577aa; font-weight: 600; }')
    [void]$html.AppendLine('.callout.atencao { background: #f7e6d8; }')
    [void]$html.AppendLine('.callout.dica { background: #eef7d8; }')
    [void]$html.AppendLine('.callout.regra { background: #e3eefc; }')
    [void]$html.AppendLine('.callout.erro { background: #f6dcdc; }')
    [void]$html.AppendLine('.placeholder { margin: 10pt 0; padding: 18pt 12pt; text-align: center; border: 1pt solid #97a3b9; background: #eef2f7; font-style: italic; font-weight: 600; }')
    [void]$html.AppendLine('.toc-note { margin: 6pt 0 14pt; padding: 10pt 12pt; background: #eef2f7; border: 1pt solid #c8d1e0; }')
    [void]$html.AppendLine('.pagebreak { page-break-before: always; }')
    [void]$html.AppendLine('</style></head><body>')

    $i = 0
    while ($i -lt $MarkdownLines.Count) {
        $line = [string]$MarkdownLines[$i]
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            $i++
            continue
        }
        if ($trimmed -eq '[[PAGEBREAK]]') {
            [void]$html.AppendLine('<div class="pagebreak"></div>')
            $i++
            continue
        }
        if ($trimmed -eq '[[TOC]]') {
            [void]$html.AppendLine('<div class="toc-note"><strong>Sumário:</strong> use o painel de navegação do Word ou atualize o campo de sumário após abrir o documento, se desejar uma versão automática.</div>')
            $i++
            continue
        }
        if ($trimmed -match '^(#{1,3})\s+(.+)$') {
            $level = $Matches[1].Length
            $text = [System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $Matches[2]))
            [void]$html.AppendLine("<h$level>$text</h$level>")
            $i++
            continue
        }
        if ($trimmed -match '^\>\s+\[!(ATENCAO|DICA|REGRA|ERRO)\]\s*(.+)$') {
            $type = $Matches[1].ToLowerInvariant()
            $label = switch ($Matches[1]) {
                "ATENCAO" { "ATENCAO" }
                "DICA" { "DICA" }
                "REGRA" { "REGRA" }
                default { "ERRO COMUM" }
            }
            $body = [System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $Matches[2]))
            [void]$html.AppendLine("<div class='callout $type'><strong>${label}:</strong> $body</div>")
            $i++
            continue
        }
        if ($trimmed -match '^\[INSERIR IMAGEM\s*-\s*(.+)\]$') {
            $body = [System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $Matches[1]))
            [void]$html.AppendLine("<div class='placeholder'>INSERIR IMAGEM<br />$body</div>")
            $i++
            continue
        }
        if ($trimmed -match '^\-\s+(.+)$') {
            [void]$html.AppendLine('<ul>')
            while ($i -lt $MarkdownLines.Count -and $MarkdownLines[$i].Trim() -match '^\-\s+(.+)$') {
                $item = [System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $Matches[1]))
                [void]$html.AppendLine("<li>$item</li>")
                $i++
            }
            [void]$html.AppendLine('</ul>')
            continue
        }
        if ($trimmed -match '^\d+\.\s+(.+)$') {
            [void]$html.AppendLine('<ol>')
            while ($i -lt $MarkdownLines.Count -and $MarkdownLines[$i].Trim() -match '^\d+\.\s+(.+)$') {
                $item = [System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $Matches[1]))
                [void]$html.AppendLine("<li>$item</li>")
                $i++
            }
            [void]$html.AppendLine('</ol>')
            continue
        }
        $parts = New-Object System.Collections.Generic.List[string]
        while ($i -lt $MarkdownLines.Count) {
            $candidate = [string]$MarkdownLines[$i]
            $candidateTrimmed = $candidate.Trim()
            if ([string]::IsNullOrWhiteSpace($candidateTrimmed)) { break }
            if ($candidateTrimmed -match '^(\[\[PAGEBREAK\]\]|\[\[TOC\]\]|#{1,3}\s+|\>\s+\[!|\-\s+|\d+\.\s+|\[INSERIR IMAGEM\s*\-)') { break }
            [void]$parts.Add([System.Net.WebUtility]::HtmlEncode((Normalize-InlineText $candidateTrimmed)))
            $i++
        }
        [void]$html.AppendLine("<p>$($parts -join ' ')</p>")
    }

    [void]$html.AppendLine('</body></html>')
    return $html.ToString()
}

function New-DocxFromHtml {
    param(
        [string]$HtmlContent,
        [string]$DocxPath
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("training-doc-" + [guid]::NewGuid().ToString("N"))
    $null = New-Item -ItemType Directory -Force -Path $tempRoot, (Join-Path $tempRoot "_rels"), (Join-Path $tempRoot "docProps"), (Join-Path $tempRoot "word"), (Join-Path $tempRoot "word\\_rels")

    $contentTypes = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="html" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
'@
    $rootRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
'@
    $documentXml = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 w15 wp14">
  <w:body>
    <w:altChunk r:id="htmlChunk"/>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
'@
    $documentRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="htmlChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="training.html"/>
</Relationships>
'@
    $coreXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Manual Mestre de Treinamento Operacional</dc:title>
  <dc:subject>Treinamento operacional</dc:subject>
  <dc:creator>Codex</dc:creator>
  <cp:keywords>auditoria; treinamento; operacao</cp:keywords>
  <dc:description>Manual operacional por modulo com placeholders de imagem.</dc:description>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$(Get-Date -Format s)Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$(Get-Date -Format s)Z</dcterms:modified>
</cp:coreProperties>
"@
    $appXml = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company>Auditoria</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
'@

    [System.IO.File]::WriteAllText((Join-Path $tempRoot '[Content_Types].xml'), $contentTypes, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot '_rels\.rels'), $rootRels, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot 'word\document.xml'), $documentXml, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot 'word\_rels\document.xml.rels'), $documentRels, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot 'docProps\core.xml'), $coreXml, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot 'docProps\app.xml'), $appXml, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText((Join-Path $tempRoot 'word\training.html'), $HtmlContent, [System.Text.UTF8Encoding]::new($false))

    $docxFullPath = Resolve-RepoPath $DocxPath
    $docxDir = Split-Path -Parent $docxFullPath
    if (-not (Test-Path -LiteralPath $docxDir)) {
        New-Item -ItemType Directory -Force -Path $docxDir | Out-Null
    }
    if (Test-Path -LiteralPath $docxFullPath) {
        Remove-Item -LiteralPath $docxFullPath -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempRoot, $docxFullPath)
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

function Finalize-DocxInWord {
    param([string]$DocxPath)
    try {
        $fullPath = Resolve-RepoPath $DocxPath
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $document = $word.Documents.Open($fullPath)
        Start-Sleep -Seconds 2
        $document.Save()
        $document.Close() | Out-Null
        $word.Quit() | Out-Null
    }
    catch {
        Write-Warning "Nao foi possivel materializar o DOCX no Word automaticamente: $($_.Exception.Message)"
    }
    finally {
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
}

function Convert-MarkdownToWord {
    param(
        [string]$MarkdownPath,
        [string]$DocxPath
    )
    $markdownLines = Get-Content -LiteralPath (Resolve-RepoPath $MarkdownPath) -Encoding UTF8
    $htmlContent = Convert-MarkdownToHtml -MarkdownLines $markdownLines
    New-DocxFromHtml -HtmlContent $htmlContent -DocxPath $DocxPath
    Finalize-DocxInWord -DocxPath $DocxPath
}

$sourcePath = Resolve-RepoPath $SourceRoot
if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Pasta fonte nao encontrada: $SourceRoot"
}

$expectedModules = Get-ExpectedModules
Test-ModuleCoverage -Root $sourcePath -ExpectedModules $expectedModules
$files = Get-SourceFiles -Root $sourcePath
Build-ConsolidatedMarkdown -Files $files -Destination $OutputMarkdown
Convert-MarkdownToWord -MarkdownPath $OutputMarkdown -DocxPath $OutputDocx
Write-Host "Manual consolidado em $OutputMarkdown"
Write-Host "Documento Word gerado em $OutputDocx"
