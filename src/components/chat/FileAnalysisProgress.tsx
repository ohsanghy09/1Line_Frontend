import { Check, Loader, Sparkles } from 'lucide-react'
import type { ChatProgress } from '../../types/chat'

// AI 서버가 제공한 진행 단계와 완료 상태를 표시한다.
function FileAnalysisProgress({ progress }: { progress: ChatProgress }) {
    return (
        <div role="status" className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
            </div>

            <div className="bg-white border border-brand-border p-4 rounded-2xl rounded-tl-sm text-xs space-y-2 w-64 max-w-[calc(100%-2.75rem)] shadow-soft">
                <p className="font-semibold text-brand-text">{progress.title}</p>
                <div className="space-y-1 text-brand-muted text-[11px]">
                    {progress.steps.map((step) => (
                        <p key={step.label} className={`flex items-center gap-1 ${step.status === 'completed' ? 'text-emerald-600' : 'text-brand-primary font-medium animate-pulse'}`}>
                            {step.status === 'completed'
                                ? <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
                                : <Loader className="w-3 h-3 shrink-0 animate-spin" aria-hidden="true" />}
                            {step.label}
                        </p>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default FileAnalysisProgress
