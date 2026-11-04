import { useState } from 'react'
import { ChevronDown, FileText, FolderOpen } from 'lucide-react'
import type { FootprintFolder } from '../../types/footprints'

function ActivityFolders({ folders, onSelectFile }: { folders: FootprintFolder[]; onSelectFile: (fileId: string) => void }) {
    // 원본처럼 모든 폴더를 처음에는 펼친다. 각 폴더의 접힘 상태는 ID로 독립 관리한다.
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())

    function toggleFolder(id: string) {
        setCollapsedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    if (folders.length === 0) {
        return <p className="p-6 text-center text-xs text-brand-muted bg-white rounded-xl border border-brand-border">보관된 자료 폴더가 아직 준비되지 않았습니다.</p>
    }

    return (
        <div className="space-y-3">
            {folders.map(folder => {
                const isExpanded = !collapsedIds.has(folder.id)
                const panelId = `folder-files-${folder.id}`

                return (
                    <div key={folder.id} className="bg-white rounded-2xl border border-brand-border overflow-hidden shadow-soft">
                        <h4>
                            <button
                                type="button"
                                id={`folder-heading-${folder.id}`}
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                                onClick={() => toggleFolder(folder.id)}
                                className="w-full p-4 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
                            >
                                <span className="flex flex-wrap items-center gap-3 min-w-0">
                                    <FolderOpen aria-hidden="true" className="w-5 h-5 shrink-0 text-brand-primary" />
                                    <span className="font-bold text-sm text-brand-text wrap-anywhere">📁 {folder.name}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{folder.materialsCount}개</span>
                                </span>
                                <ChevronDown aria-hidden="true" className={`w-4 h-4 shrink-0 text-brand-muted ${isExpanded ? '' : '-rotate-90'}`} />
                            </button>
                        </h4>

                        <div id={panelId} hidden={!isExpanded} aria-labelledby={`folder-heading-${folder.id}`} className="border-t border-brand-border/60 bg-slate-50/30">
                            {folder.files.length === 0 ? (
                                <p className="p-5 text-xs text-brand-muted">이 폴더에 보관된 자료가 없어요.</p>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {folder.files.map(file => (
                                        <li key={file.id}>
                                            <button type="button" onClick={() => onSelectFile(file.id)} aria-haspopup="dialog" className="w-full p-3.5 px-5 flex items-center justify-between gap-3 text-left hover:bg-indigo-50/40 transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary">
                                                <span className="flex items-center gap-3 min-w-0">
                                                    <FileText aria-hidden="true" className="w-4 h-4 shrink-0 text-brand-muted" />
                                                    <span className="min-w-0">
                                                        <span className="block text-xs font-semibold text-brand-text wrap-anywhere">{file.name}</span>
                                                        <span className="block text-[10px] text-brand-muted wrap-anywhere">{file.type} · {file.uploadedAtLabel}</span>
                                                    </span>
                                                </span>
                                                {file.version && <span className="shrink-0 px-2 py-0.5 bg-brand-secondarySoft text-brand-secondary text-[10px] font-semibold rounded">{file.version}</span>}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default ActivityFolders
