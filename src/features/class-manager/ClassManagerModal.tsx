import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { sfx } from '../../lib/sfx';
import './ClassManagerModal.css';

interface ClassManagerModalProps {
  onClose: () => void;
}

type Tab = 'students' | 'topics' | 'questions';

export function ClassManagerModal({ onClose }: ClassManagerModalProps) {
  const { i18n } = useTranslation();
  const students = useClassStore(s => s.students);
  const topics = useClassStore(s => s.topics);
  const questions = useClassStore(s => s.questions);
  const addStudentsBatch = useClassStore(s => s.addStudentsBatch);
  const removeStudent = useClassStore(s => s.removeStudent);
  const toggleStudentActive = useClassStore(s => s.toggleStudentActive);
  const addTopicsBatch = useClassStore(s => s.addTopicsBatch);
  const removeTopic = useClassStore(s => s.removeTopic);
  const addQuestionsBatch = useClassStore(s => s.addQuestionsBatch);
  const removeQuestion = useClassStore(s => s.removeQuestion);

  const [activeTab, setActiveTab] = useState<Tab>('students');
  const [batchText, setBatchText] = useState('');

  const lang = i18n.language === 'es' ? 'es' : 'en';

  const handleAddBatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchText.trim()) return;
    const lines = batchText.split('\n');
    sfx.click();

    if (activeTab === 'students') {
      addStudentsBatch(lines);
    } else if (activeTab === 'topics') {
      addTopicsBatch(lines);
    } else {
      addQuestionsBatch(lines);
    }
    setBatchText('');
  };

  return (
    <div className="rc-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="rc-cut rc-cm-card" onClick={e => e.stopPropagation()}>
        <header className="rc-cm-header">
          <div className="rc-cm-title">
            <span className="rc-cm-icon">📋</span>
            <h2>{lang === 'es' ? 'Configuración de Clase' : 'Class Configuration'}</h2>
          </div>
          <button type="button" className="rc-cut rc-cm-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="rc-cm-tabs">
          <button
            type="button"
            className={`rc-cut rc-cm-tab ${activeTab === 'students' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('students')}
          >
            <span>👨‍🚀 {lang === 'es' ? 'Estudiantes' : 'Students'} ({students.length})</span>
          </button>
          <button
            type="button"
            className={`rc-cut rc-cm-tab ${activeTab === 'topics' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('topics')}
          >
            <span>💬 {lang === 'es' ? 'Temas' : 'Topics'} ({topics.length})</span>
          </button>
          <button
            type="button"
            className={`rc-cut rc-cm-tab ${activeTab === 'questions' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            <span>❓ {lang === 'es' ? 'Preguntas' : 'Questions'} ({questions.length})</span>
          </button>
        </div>

        <div className="rc-cm-body">
          {/* Form to paste batch items */}
          <form className="rc-cm-batch-form" onSubmit={handleAddBatch}>
            <label className="rc-cm-batch-label">
              {activeTab === 'students'
                ? (lang === 'es' ? 'Pegar estudiantes (uno por línea):' : 'Paste students (one per line):')
                : activeTab === 'topics'
                ? (lang === 'es' ? 'Pegar temas (uno por línea):' : 'Paste topics (one per line):')
                : (lang === 'es' ? 'Pegar preguntas (una por línea):' : 'Paste questions (one per line):')}
            </label>
            <div className="rc-cm-input-row">
              <textarea
                className="rc-cm-textarea"
                rows={2}
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                placeholder={
                  activeTab === 'students'
                    ? 'Carlos\nMaría\nAlejandro'
                    : activeTab === 'topics'
                    ? 'Sports\nFavorite food\nTravel dreams'
                    : 'What did you eat today?\nWhere are you from?'
                }
              />
              <button type="submit" className="rc-cut rc-cm-add-btn">
                {lang === 'es' ? '+ Agregar' : '+ Add'}
              </button>
            </div>
          </form>

          {/* List of current items */}
          <div className="rc-cm-items-list">
            {activeTab === 'students' && (
              students.map(st => (
                <div key={st.id} className="rc-cm-item-row">
                  <button
                    type="button"
                    className={`rc-cm-active-toggle ${st.active ? 'is-active' : ''}`}
                    onClick={() => toggleStudentActive(st.id)}
                    title={st.active ? 'Marcar ausente' : 'Marcar presente'}
                  >
                    {st.active ? '✓' : '—'}
                  </button>
                  <span className={`rc-cm-item-name ${st.active ? '' : 'is-faded'}`}>{st.name}</span>
                  <span className="rc-cm-item-pts">{st.points} pts</span>
                  <button
                    type="button"
                    className="rc-cm-del-btn"
                    onClick={() => removeStudent(st.id)}
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}

            {activeTab === 'topics' && (
              topics.map(tp => (
                <div key={tp.id} className="rc-cm-item-row">
                  <span className="rc-cm-item-name">{tp.text}</span>
                  <button
                    type="button"
                    className="rc-cm-del-btn"
                    onClick={() => removeTopic(tp.id)}
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}

            {activeTab === 'questions' && (
              questions.map(q => (
                <div key={q.id} className="rc-cm-item-row">
                  <span className="rc-cm-item-name">{q.text}</span>
                  <button
                    type="button"
                    className="rc-cm-del-btn"
                    onClick={() => removeQuestion(q.id)}
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
