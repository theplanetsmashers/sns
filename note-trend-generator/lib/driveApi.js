// lib/driveApi.js
// Google Drive API v3への薄いラッパー。サービスアカウントのアクセストークンを使い、
// 指定フォルダ配下のファイル一覧取得と、ファイル本文(プレーンテキスト)の取得を行う。

async function listFolderFiles(accessToken, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=200`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive APIファイル一覧取得エラー: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return data.files || [];
}

async function getFileText(accessToken, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive APIファイル本文取得エラー: ${response.status} ${errText}`);
  }
  return response.text();
}

module.exports = { listFolderFiles, getFileText };
