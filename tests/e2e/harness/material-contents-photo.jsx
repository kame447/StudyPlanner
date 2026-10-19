import React from 'react';
import ReactDOM from 'react-dom/client';
import { BookshelfView } from '../../../src/components/BookshelfView';
import '../../../src/styles.css';
const material = { id: 'photo-book', userId: 'photo-ui-owner', name: '目次取込テスト教材', subjectId: 'math', subjectName: '数学', status: 'active', paceEnabled: true, progressUnit: 'page', currentUnit: 0, totalUnits: 200, createdAt: '', updatedAt: '' };
const noop = () => {};
ReactDOM.createRoot(document.getElementById('root')).render(<BookshelfView userId="photo-ui-owner" subjects={[]} materials={[material]} plans={[]} actuals={[]} onSaveSubject={noop} onDeleteSubject={noop} onCaptureMaterialBaseline={noop} onSaveMaterial={noop} onDeleteMaterial={noop} onAddMaterialToPlan={noop} />);
