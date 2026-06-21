// Supported emojis and their effects, from the official Irodori-TTS
// EMOJI_ANNOTATIONS.md:
// https://huggingface.co/Aratako/Irodori-TTS-500M/blob/main/EMOJI_ANNOTATIONS.md

export interface EmojiDef {
  emoji: string;
  /** Japanese effect description. */
  label: string;
}

export const EMOJIS: EmojiDef[] = [
  { emoji: '👂', label: '囁き、耳元の音' },
  { emoji: '😮‍💨', label: '吐息、溜息、寝息' },
  { emoji: '⏸️', label: '間、沈黙' },
  { emoji: '🤭', label: '笑い（くすくす、含み笑い）' },
  { emoji: '🥵', label: '喘ぎ、うめき声、唸り声' },
  { emoji: '📢', label: 'エコー、リバーブ' },
  { emoji: '😏', label: 'からかうように、甘えるように' },
  { emoji: '🥺', label: '声を震わせ、自信なさげに' },
  { emoji: '🌬️', label: '息切れ、荒い息遣い、呼吸音' },
  { emoji: '😮', label: '息をのむ' },
  { emoji: '👅', label: '舐める音、咀嚼音、水音' },
  { emoji: '💋', label: 'リップノイズ' },
  { emoji: '🫶', label: '優しく' },
  { emoji: '😭', label: '嗚咽、泣き声、悲しみ' },
  { emoji: '😱', label: '悲鳴、叫び、絶叫' },
  { emoji: '😪', label: '眠そうに、気だるげに' },
  { emoji: '⏩', label: '早口、まくしたてる、急いで' },
  { emoji: '📞', label: '電話・スピーカー越しの音' },
  { emoji: '🐢', label: 'ゆっくりと' },
  { emoji: '🥤', label: '唾を飲み込む音' },
  { emoji: '🤧', label: '咳き込み、鼻すすり、くしゃみ' },
  { emoji: '😒', label: '舌打ち' },
  { emoji: '😰', label: '慌てて、動揺、緊張、どもり' },
  { emoji: '😆', label: '喜びながら' },
  { emoji: '😠', label: '怒り、不満げに、拗ねながら' },
  { emoji: '😲', label: '驚き、感嘆' },
  { emoji: '🥱', label: 'あくび' },
  { emoji: '😖', label: '苦しげに' },
  { emoji: '😟', label: '心配そうに' },
  { emoji: '🫣', label: '恥ずかしそうに、照れながら' },
  { emoji: '🙄', label: '呆れたように' },
  { emoji: '😊', label: '楽しげに、嬉しそうに' },
  { emoji: '👌', label: '相槌、頷く音' },
  { emoji: '🙏', label: '懇願するように' },
  { emoji: '🥴', label: '酔っ払って' },
  { emoji: '🎵', label: '鼻歌' },
  { emoji: '🤐', label: '口を塞がれて' },
  { emoji: '😌', label: '安堵、満足げに' },
  { emoji: '🤔', label: '疑問の声' },
];
