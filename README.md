# Agenda de Salas — SVN Investimentos (Campo Grande/MS)

Sistema de reserva das salas de reunião do escritório. Vite + React + TypeScript, publicado no **GitHub Pages**: https://lucascampanini.github.io/agenda-salas-svn/

O Supabase cuida do banco, do login, do tempo real e da Edge Function `admin-users`.

As regras críticas moram **no banco**, não só na tela:

- **Sem sobreposição:** exclusion constraint `bookings_no_overlap` (btree_gist + `tstzrange &&`).
- **Dias e horários válidos:** o trigger `validate_booking` só aceita segunda a sexta, dentro do horário de funcionamento e nunca no passado. Qualquer minuto é aceito (ex.: 09:07 às 09:43); a grade só é desenhada de 30 em 30.
- **Permissões:** Row Level Security. Usuário comum só cria e cancela as próprias reservas; só admin mexe em salas; perfis só mudam pela Edge Function `admin-users`, que confere se quem chama é admin e usa a service role key dentro do Supabase. A chave nunca vai para o navegador.

## Cadastrar usuários

O cadastro público fica desligado. Há dois jeitos de dar acesso:

**A) Link de convite (a pessoa se cadastra sozinha):**
1. Em **Admin → Usuários → Link de convite**, clique em **Criar link de convite** e depois em **Copiar**.
2. Mande o link aos colegas. Cada um preenche nome, e-mail e a senha que escolher.
3. O pedido aparece em **Aguardando aprovação**, e o botão Admin mostra quantos pedidos há. Clique em **Aprovar** ou **Recusar**.
4. **Gerar novo link** invalida o anterior; **Desligar link** encerra os cadastros.

**B) Cadastro direto pelo admin:**

1. Entre no site com uma conta de administrador e clique em **Admin → Usuários**.
2. Em **Novo usuário**, preencha nome, e-mail e senha inicial (o botão **Gerar** cria uma senha aleatória). Marque **Administrador** se for o caso.
3. Clique em **Criar usuário** e envie o e-mail e a senha ao colega. A conta já nasce confirmada.

Na mesma tela você pode **Tornar admin / Remover admin**, **Desativar / Reativar** (bloqueia o login na hora, sem apagar o histórico) e definir **Nova senha**.

### Primeiro administrador

O primeiro administrador precisa ser criado pelo painel do Supabase:

1. Supabase → **Authentication → Users → Add user → Create new user**. Informe e-mail e senha e marque **Auto Confirm User**.
2. Supabase → **SQL Editor**, rode o comando abaixo trocando o e-mail e o nome:

   ```sql
   update public.profiles
   set is_admin = true, active = true, pending = false, full_name = 'Seu Nome'
   where email = 'seu-email@svninvestimentos.com.br';
   ```

## Alterar horários de funcionamento

O horário fica na tabela `settings` (uma linha só). No **SQL Editor** do Supabase:

```sql
-- Exemplo: das 07:30 às 19:00
update public.settings set open_time = '07:30', close_time = '19:00';

-- Linhas da grade de 15 em 15 minutos em vez de 30 (aceitos: 10, 15, 20, 30, 60)
update public.settings set slot_minutes = 15;

-- Precisão das reservas. Padrão: 1 = qualquer minuto (ex.: 09:07 às 09:43).
-- Para exigir horários de 5 em 5 minutos (aceitos: 1, 5, 10, 15, 30, 60):
update public.settings set booking_step_minutes = 5;

-- Conferir
select * from public.settings;
```

A grade e a validação do banco passam a usar os novos valores assim que a página for recarregada, sem novo deploy. Reservas já existentes não mudam. O banco recusa combinações inválidas, como abrir depois de fechar ou blocos que não cabem certinho no expediente.

Os dias úteis (segunda a sexta) estão fixos no trigger `validate_booking` e na grade (`weekDays` em `src/lib/time.ts`).

## Salas

Em **Admin → Salas** você cria, renomeia e exclui salas. Excluir uma sala apaga as reservas dela, e a tela avisa quantas reservas futuras serão perdidas antes de confirmar.

## Agenda de especialistas

Aba **Especialistas**: um administrador cria a agenda de um especialista que vem a Campo Grande (**+ Nova agenda**) informando a chegada (dia e hora) e a saída (dia e hora). Nos dias da visita o atendimento vai das 07:00 às 19:00, começando na chegada no primeiro dia e terminando na saída no último. Fim de semana só entra se marcado. A grade funciona como a de salas: cada assessor clica num horário livre e escolhe início e fim.

- **No escritório:** a pessoa escolhe a sala, que é reservada na agenda de salas **na mesma transação** (função `book_specialist`). Cancelar o horário com o especialista libera a sala; cancelar a sala pela agenda de salas cancela também o horário com o especialista.
- **Fora do escritório:** sem sala; o local é opcional.
- As regras ficam no banco (`supabase/especialistas.sql`): o especialista não atende duas pessoas ao mesmo tempo, os horários respeitam chegada, saída e o horário diário, e agendar e cancelar só é possível pelas funções `book_specialist` e `cancel_specialist_booking`.
- Para mudar o horário diário de uma visita: `update public.specialist_visits set day_start = '08:00', day_end = '18:00' where id = '...';`

O script só acrescenta tabelas e funções. Para aplicar ou atualizar: `npx supabase db query --linked -f supabase/especialistas.sql` (depois do `schema.sql`).

## Convite pelo Outlook

Depois de reservar uma sala ou agendar com um especialista, abre a janela **Enviar convite**:

- **Abrir no Outlook** abre o Outlook na web (Microsoft 365) com a reunião preenchida (título, horário, local e convidados). A pessoa confere e clica em Enviar; o convite sai do e-mail dela.
- **Baixar .ics** gera um arquivo para o Outlook do computador, o Google Agenda ou o celular.

Administradores escolhem os convidados da reserva de sala numa lista com todos os usuários cadastrados, além dos e-mails digitados. No especialista, o e-mail dele (se cadastrado) entra automaticamente. O envio não é automático: não há servidor de e-mail. O botão **Convite** nos detalhes da reserva abre o convite de novo (sem os convidados, que não ficam guardados).

## Publicação e configuração

- **Site:** cada push na branch `main` roda o workflow `.github/workflows/deploy.yml`, que gera o build e publica no GitHub Pages.
- **Chaves públicas:** ficam em GitHub → Settings → Secrets and variables → Actions → **Variables**:
  - `VITE_SUPABASE_URL`: URL do projeto Supabase;
  - `VITE_SUPABASE_ANON_KEY`: chave anon/publishable. É pública por design; quem protege os dados é o RLS.

  Depois de mudar uma delas, rode o workflow de novo em Actions → Publicar no GitHub Pages → Run workflow.
- **Service role key:** não fica em nenhum arquivo nem no GitHub. O Supabase injeta essa chave sozinho na Edge Function.
- **Edge Function:** o código está em `supabase/functions/admin-users/index.ts`. Para atualizar, vá em Supabase → Edge Functions → `admin-users` → Code, cole o arquivo e clique em **Deploy**.

## Estrutura

```
supabase/schema.sql      script completo do banco (pode rodar mais de uma vez)
supabase/functions/admin-users/index.ts   Edge Function: criar/desativar usuários, admin, senha
.github/workflows/deploy.yml   publicação automática no GitHub Pages
src/App.tsx              sessão, carregamento de dados, tempo real, navegação
src/components/          grade do dia, formulário, painel lateral, admin
src/lib/time.ts          conversões de fuso (America/Campo_Grande)
```

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha a URL e a chave anon
npm run dev
```

O painel de usuários chama a Edge Function publicada no Supabase, então funciona igual em modo local.
